import { validateAppManifest, validateRegistry, manualStepApplies } from './app-manifest.util';
import { APPLIES_WHEN_VALUES, type AppManualStep } from './app-manifest.types';

export const TEST_MANIFEST = {
  schemaVersion: 1,
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  summary: 'Share files and folders with ACLs',
  requires: { presignedStorage: true, ceMin: '0.3.15' },
  install: {
    alias: 'handoff',
    deployment: { path: 'dist', basePath: '/apps/handoff/dist' },
    ruleSets: [
      { file: 'rulesets/handoff.json', attachToAlias: true },
      { file: 'rulesets/handoff-rss-feed.json', attachToAlias: true },
    ],
    domain: { subdomain: 'handoff', isPublic: true, isSpa: true },
    schedules: [],
    manualSteps: [
      {
        id: 'bucket-cors',
        title: 'Configure bucket CORS',
        body: 'Allow PUT from your app origin on the storage bucket.',
        appliesWhen: 'bucketStorage',
      },
    ],
  },
  eject: {
    repo: 'bffless/apps',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    variables: ['BFFLESS_URL', 'BFFLESS_PROJECT'],
    secrets: ['BFFLESS_API_KEY'],
  },
};

describe('validateAppManifest', () => {
  it('accepts a fully valid Handoff-shaped manifest and round-trips it', () => {
    const result = validateAppManifest(TEST_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toEqual(TEST_MANIFEST);
    }
  });

  it('fails when schemaVersion is not 1', () => {
    const result = validateAppManifest({ ...TEST_MANIFEST, schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('schemaVersion: must be 1');
    }
  });

  it('fails when id is missing', () => {
    const { id: _id, ...rest } = TEST_MANIFEST;
    const result = validateAppManifest(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('id:'))).toBe(true);
    }
  });

  it('fails when version is missing', () => {
    const { version: _version, ...rest } = TEST_MANIFEST;
    const result = validateAppManifest(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('version:'))).toBe(true);
    }
  });

  it('fails when install.alias is missing', () => {
    const { alias: _alias, ...restInstall } = TEST_MANIFEST.install;
    const result = validateAppManifest({ ...TEST_MANIFEST, install: restInstall });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('install.alias:'))).toBe(true);
    }
  });

  it('fails when a ruleSets entry is missing file', () => {
    const manifest = {
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        ruleSets: [{ attachToAlias: true }],
      },
    };
    const result = validateAppManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('install.ruleSets[0].file: required string');
    }
  });

  it('fails when a manualSteps entry has an appliesWhen outside the closed enum, naming the enum', () => {
    const manifest = {
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        manualSteps: [
          { id: 'x', title: 'X', body: 'Y', appliesWhen: 'sometimes' },
        ],
      },
    };
    const result = validateAppManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.startsWith('install.manualSteps[0].appliesWhen:'));
      expect(err).toBeDefined();
      for (const value of APPLIES_WHEN_VALUES) {
        expect(err).toContain(value);
      }
    }
  });

  it.each([
    ['a dot', 'han.doff'],
    ['uppercase', 'Handoff'],
  ])('fails when subdomain contains %s', (_label, subdomain) => {
    const manifest = {
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        domain: { ...TEST_MANIFEST.install.domain, subdomain },
      },
    };
    const result = validateAppManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('install.domain.subdomain:'))).toBe(true);
    }
  });

  it('fails when alias violates /^[a-zA-Z0-9_-]+$/', () => {
    const manifest = {
      ...TEST_MANIFEST,
      install: { ...TEST_MANIFEST.install, alias: 'bad alias!' },
    };
    const result = validateAppManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('install.alias:'))).toBe(true);
    }
  });
});

describe('validateRegistry', () => {
  const validRegistry = {
    schemaVersion: 1,
    apps: [
      {
        id: 'handoff',
        name: 'Handoff',
        version: '1.0.0',
        bundleUrl: 'https://example.com/handoff.zip',
        sha256: 'a'.repeat(64),
      },
    ],
  };

  it('accepts a valid registry and round-trips it', () => {
    const result = validateRegistry(validRegistry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry).toEqual(validRegistry);
    }
  });

  it('fails when apps is not an array', () => {
    const result = validateRegistry({ schemaVersion: 1, apps: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('apps: must be an array');
    }
  });

  it('fails when a registry entry is missing sha256', () => {
    const { sha256: _sha256, ...entry } = validRegistry.apps[0];
    const result = validateRegistry({ schemaVersion: 1, apps: [entry] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('apps[0].sha256: required string');
    }
  });
});

describe('manualStepApplies', () => {
  const baseStep: AppManualStep = { id: 's', title: 'T', body: 'B' };

  it('applies when appliesWhen is "always" or omitted', () => {
    expect(manualStepApplies(baseStep, { bucketStorage: false, platformMode: false })).toBe(true);
    expect(
      manualStepApplies({ ...baseStep, appliesWhen: 'always' }, { bucketStorage: false, platformMode: false }),
    ).toBe(true);
  });

  it('applies "bucketStorage" only when ctx.bucketStorage is true', () => {
    const step: AppManualStep = { ...baseStep, appliesWhen: 'bucketStorage' };
    expect(manualStepApplies(step, { bucketStorage: true, platformMode: false })).toBe(true);
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: false })).toBe(false);
  });

  it('applies "localStorage" only when ctx.bucketStorage is false', () => {
    const step: AppManualStep = { ...baseStep, appliesWhen: 'localStorage' };
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: false })).toBe(true);
    expect(manualStepApplies(step, { bucketStorage: true, platformMode: false })).toBe(false);
  });

  it('applies "platformMode" only when ctx.platformMode is true', () => {
    const step: AppManualStep = { ...baseStep, appliesWhen: 'platformMode' };
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: true })).toBe(true);
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: false })).toBe(false);
  });

  it('applies "selfHosted" only when ctx.platformMode is false', () => {
    const step: AppManualStep = { ...baseStep, appliesWhen: 'selfHosted' };
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: false })).toBe(true);
    expect(manualStepApplies(step, { bucketStorage: false, platformMode: true })).toBe(false);
  });
});
