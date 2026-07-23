import { Page } from '@playwright/test';

/**
 * Mocks the full REST surface the web-bootstrap wizard touches, minus the
 * Domain & SSL / Apply endpoints (those are asserted per-scenario in
 * bootstrap-wizard.spec.ts). Mirrors the pattern used by
 * `helpers/mock-api.ts` for the repo browser: `page.route` per endpoint,
 * `route.fulfill` with a realistic body.
 *
 * Lands the wizard directly on the `domain-ssl` step: `getSetupStatus`
 * reports bootstrapMode:true, claimRequired:false (so the optional 'claim'
 * step is skipped) and hasAdminUser:true with no storageProvider —
 * SetupWizard's auto-advance effect (computeWizardSteps + the
 * hasAdminUser/storageProvider checks in SetupWizard.tsx) lands exactly on
 * the step after 'admin', which is 'domain-ssl', without needing to drive
 * a real admin-creation form first.
 */
export async function mockBootstrapStatus(page: Page) {
  await page.route('**/api/setup/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isSetupComplete: false,
        bootstrapMode: true,
        claimRequired: false,
        hasAdminUser: true,
        // storageProvider intentionally omitted — see doc comment above.
      }),
    });
  });
}

/**
 * Mocks storage/cache/email so the wizard can click straight through them
 * to Apply. Uses the "everything is platform-managed / skip-eligible"
 * shape of AvailableOptionsResponse: StorageStep auto-selects 'managed' (a
 * single "Configure Storage" click), and CacheStep/EmailStep both render
 * their `shouldSkipStep` pre-configured view (a single "Continue" click) —
 * see CacheStep.tsx/EmailStep.tsx's `shouldSkipStep` branch. This is
 * deliberately the fastest legitimate path through those steps so each
 * scenario's real assertions can stay on Domain & SSL / Apply.
 */
export async function mockPassthroughSteps(page: Page) {
  await page.route('**/api/setup/constraints', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        minio: { enabled: true, reason: null },
        redis: { enabled: true, reason: null },
      }),
    });
  });

  await page.route('**/api/setup/available-options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        storage: { managed: true, s3: false, gcs: false, azure: false, local: false, minio: false },
        cache: {
          lru: true,
          managedRedis: false,
          localRedis: true,
          externalRedis: true,
          skipStep: true,
          defaultType: 'memory',
        },
        email: {
          managed: true,
          smtp: false,
          sendgrid: false,
          resend: false,
          skipAllowed: true,
          skipStep: true,
          defaultType: 'managed',
        },
        ui: { enableEnvOptimizationHints: false, enableSettingsUpdateNote: false },
      }),
    });
  });

  await page.route('**/api/setup/storage', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'ok', storageProvider: 'managed' }),
    });
  });

  await page.route('**/api/setup/test-storage', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'ok' }),
    });
  });

  await page.route('**/api/setup/cache', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: false, type: 'memory', isConfigured: false }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'ok' }),
    });
  });

  await page.route('**/api/setup/cache/defaults', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ host: 'redis', port: 6379, isDocker: true }),
    });
  });

  await page.route('**/api/setup/email-providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: [] }),
    });
  });

  await page.route('**/api/setup/email', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'ok', provider: 'managed', emailConfigured: true }),
    });
  });
}

/** A minimal, syntactically-real-looking PEM the wizard treats as opaque text (upload is mocked). */
export const FAKE_CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBfakefakefakefakefake\n-----END CERTIFICATE-----';
export const FAKE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBfakefakefakefakefake\n-----END PRIVATE KEY-----';
