import { test, expect, Page } from '@playwright/test';
import {
  mockBootstrapStatus,
  mockPassthroughSteps,
  FAKE_CERT_PEM,
  FAKE_KEY_PEM,
} from './helpers/mock-bootstrap-api';

/**
 * E2E coverage for the web-bootstrap wizard's Domain & SSL -> Apply leg (the
 * "adaptive certificate phase" from the bootstrap-domain-ssl-model plan).
 * There was no existing bootstrap/setup Playwright spec to extend — this is
 * a new spec authored in the established `e2e/` layout (see
 * repository-overview.spec.ts / proxy-rules.spec.ts for the same
 * `page.route` + fixture-helper conventions this file follows).
 *
 * Each scenario drives one full serving-path choice through to the Apply
 * step's read-only summary, which is the wizard's single point where every
 * upstream choice (serving mode, certificate source, port80, real-IP,
 * wildcard) gets reflected back for the user to confirm before it's ever
 * sent to the backend — asserting it here is a regression guard against the
 * same class of bug the final-review Critical-1 finding was (a step
 * reachable in the UI whose downstream effect silently didn't match).
 *
 * All backend calls are mocked via page.route — this exercises the real
 * wizard component tree + Redux store + RTK Query wiring against a Vite dev
 * server, not the live backend (there is no local backend in this repo's
 * dev setup; see CLAUDE.md's Local Dev Validation section).
 */

async function gotoDomainSslStep(page: Page) {
  await mockBootstrapStatus(page);
  await mockPassthroughSteps(page);
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'How does traffic reach this server?' })).toBeVisible();
}

/** Clicks through Storage (managed) -> Cache (skip-configured) -> Email (managed) to reach Apply. */
async function passThroughStorageCacheEmail(page: Page) {
  await expect(page.getByRole('heading', { name: 'Configure Storage' })).toBeVisible();
  await page.getByRole('button', { name: 'Configure Storage' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Cache Configuration' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Email Configuration' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Finish setup' })).toBeVisible();
}

async function mockApply(page: Page, domain: string) {
  await page.route('**/api/setup/apply', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applying: true, adminUrl: `https://admin.${domain}` }),
    });
  });
}

async function confirmDnsAndFinish(page: Page, domain: string) {
  const dnsCheckbox = page.getByRole('checkbox', { name: /I've pointed/ });
  if (await dnsCheckbox.isVisible()) {
    await dnsCheckbox.check();
  }
  await mockApply(page, domain);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText(`Switching to https://admin.${domain}…`)).toBeVisible();
}

test.describe('bootstrap wizard — Domain & SSL adaptive paths', () => {
  test('Cloudflare paste: closed port 80, on-by-default real-IP', async ({ page }) => {
    const domain = 'cf-bootstrap.example.com';
    await gotoDomainSslStep(page);

    await page.getByRole('radio', { name: 'Through Cloudflare (recommended)' }).check();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Domain').fill(domain);
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'Provide your Cloudflare Origin Certificate' })).toBeVisible();
    await page.getByLabel('Origin Certificate (PEM)').fill(FAKE_CERT_PEM);
    await page.getByLabel('Private Key (PEM)').fill(FAKE_KEY_PEM);
    await page.route('**/api/setup/certificates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true, sans: [domain, `*.${domain}`], wildcardCovered: true }),
      });
    });
    await page.getByRole('button', { name: 'Upload certificate' }).click();

    await passThroughStorageCacheEmail(page);

    // Apply summary must match the Cloudflare choice exactly.
    await expect(page.getByText('Serving: Through Cloudflare')).toBeVisible();
    await expect(page.getByText('Certificate: Pasted certificate')).toBeVisible();
    await expect(page.getByText('Port 80: Closed')).toBeVisible();
    await expect(page.getByText('Visitor IP restore: On')).toBeVisible();

    await confirmDnsAndFinish(page, domain);
  });

  test('CDN paste with real-IP ranges filled in', async ({ page }) => {
    const domain = 'cdn-bootstrap.example.com';
    await gotoDomainSslStep(page);

    await page.getByRole('radio', { name: 'Through another CDN or WAF' }).check();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Domain').fill(domain);
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'Provide your origin certificate' })).toBeVisible();
    await page.getByLabel('Origin Certificate (PEM)').fill(FAKE_CERT_PEM);
    await page.getByLabel('Private Key (PEM)').fill(FAKE_KEY_PEM);

    // The realIp/port80 knobs are collapsed behind a <details> — open it.
    await page.getByText('Restore visitor IPs (optional)').click();
    await page.getByLabel('Trusted ranges (CIDR, one per line)').fill('151.101.0.0/16');
    await page.getByLabel('Header carrying the visitor IP').fill('True-Client-IP');

    await page.route('**/api/setup/certificates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true, sans: [domain, `*.${domain}`], wildcardCovered: true }),
      });
    });
    await page.getByRole('button', { name: 'Upload certificate' }).click();

    await passThroughStorageCacheEmail(page);

    await expect(page.getByText('Serving: Through another CDN or WAF')).toBeVisible();
    await expect(page.getByText('Certificate: Pasted certificate')).toBeVisible();
    // Proxy mode defaults port 80 to open (redirect) unless explicitly closed.
    await expect(page.getByText('Port 80: Open (redirects to HTTPS)')).toBeVisible();
    // realIpOn is true for proxy mode ONLY when ranges were actually configured.
    await expect(page.getByText('Visitor IP restore: On')).toBeVisible();

    await confirmDnsAndFinish(page, domain);
  });

  test('Direct + BYO certificate, apex-only SANs: wildcard warning then continue', async ({ page }) => {
    const domain = 'byo-bootstrap.example.com';
    await gotoDomainSslStep(page);

    await page.getByRole('radio', { name: 'Directly' }).check();
    await page.getByRole('radio', { name: 'Paste my own certificate' }).check();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Domain').fill(domain);
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('heading', { name: 'Provide your certificate' })).toBeVisible();
    await page.getByLabel('Certificate — full chain (PEM)').fill(FAKE_CERT_PEM);
    await page.getByLabel('Private Key (PEM)').fill(FAKE_KEY_PEM);

    // Apex-only cert: no wildcard SAN, exactly the case that was impossible
    // before ECDSA/path-aware SAN support (Task 3 of this plan).
    await page.route('**/api/setup/certificates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved: true, sans: [domain], wildcardCovered: false }),
      });
    });
    await page.getByRole('button', { name: 'Upload certificate' }).click();

    await expect(
      page.getByText("This certificate doesn't cover a wildcard SAN.")
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue anyway' }).click();

    await passThroughStorageCacheEmail(page);

    await expect(page.getByText('Serving: Directly (A record to this server)')).toBeVisible();
    await expect(page.getByText('Certificate: Pasted certificate')).toBeVisible();
    await expect(page.getByText('Port 80: Open (redirects to HTTPS)')).toBeVisible();
    await expect(page.getByText('Visitor IP restore: Off')).toBeVisible();
    // Not a Let's Encrypt path, so the wildcard summary line must not render.
    await expect(page.getByText('Wildcard:')).toHaveCount(0);

    await confirmDnsAndFinish(page, domain);
  });

  test("Direct + Let's Encrypt: preflight -> issue -> skip wildcard -> apply", async ({ page }) => {
    const domain = 'le-bootstrap.example.com';
    await gotoDomainSslStep(page);

    await page.getByRole('radio', { name: 'Directly' }).check();
    await page.getByRole('radio', { name: "Auto-issue with Let's Encrypt (recommended)" }).check();
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByLabel('Domain').fill(domain);
    await page.route('**/api/setup/dns-preflight', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          checks: [
            { host: domain, resolvedIps: ['203.0.113.10'], probeOk: true },
            { host: `www.${domain}`, resolvedIps: ['203.0.113.10'], probeOk: true },
            { host: `admin.${domain}`, resolvedIps: ['203.0.113.10'], probeOk: true },
          ],
        }),
      });
    });
    const nextButton = page.getByRole('button', { name: 'Next' });
    await expect(nextButton).toBeDisabled();
    await page.getByRole('button', { name: 'Check DNS' }).click();
    await expect(page.getByText(domain).first()).toBeVisible();
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(page.getByRole('heading', { name: "Issue a Let's Encrypt certificate" })).toBeVisible();
    await page.route('**/api/setup/issue-certificate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ issued: true, sans: [domain, `www.${domain}`, `admin.${domain}`] }),
      });
    });
    await page.getByRole('button', { name: 'Issue certificate' }).click();

    await expect(page.getByText(`Certificate issued for ${domain}`)).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await passThroughStorageCacheEmail(page);

    await expect(page.getByText('Serving: Directly (A record to this server)')).toBeVisible();
    await expect(page.getByText("Certificate: Let's Encrypt (auto-renews)")).toBeVisible();
    await expect(page.getByText('Port 80: Open (redirects to HTTPS)')).toBeVisible();
    await expect(page.getByText('Visitor IP restore: Off')).toBeVisible();
    await expect(page.getByText('Wildcard: skipped (previews will warn)')).toBeVisible();
    // DNS was already proven during the earlier preflight check — the
    // confirmation checkbox must not reappear (redundant, per ApplyStep.tsx).
    await expect(page.getByText('DNS was verified during the DNS check')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I've pointed/ })).toHaveCount(0);

    await mockApply(page, domain);
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByText(`Switching to https://admin.${domain}…`)).toBeVisible();
  });
});
