import {
  validateAppManifest,
  validateRegistry,
  manualStepApplies,
  interpolateStep,
} from './app-manifest.util';
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

  it('fails when a manual step body uses an unknown placeholder, naming the known ones', () => {
    const result = validateAppManifest({
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        manualSteps: [{ id: 'x', title: 'Title', body: 'Go to {foo} now.' }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.startsWith('install.manualSteps[0].body:'));
      expect(err).toContain('unknown placeholder {foo}');
      expect(err).toContain('projectPath, appHost');
    }
  });

  it('fails when a manual step deepLink uses an unknown placeholder', () => {
    const result = validateAppManifest({
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        manualSteps: [{ id: 'x', title: 'T', body: 'B', deepLink: '/repo/{owner}/settings' }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('unknown placeholder {owner}'))).toBe(true);
    }
  });

  it('accepts the known placeholders', () => {
    const result = validateAppManifest({
      ...TEST_MANIFEST,
      install: {
        ...TEST_MANIFEST.install,
        manualSteps: [
          {
            id: 'x',
            title: 'T',
            body: 'Allow PUT from {appHost}.',
            deepLink: '/repo/{projectPath}/settings?tab=members',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
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

  it('accepts and round-trips the store-presentation fields', () => {
    const registry = {
      schemaVersion: 1,
      apps: [
        {
          ...validRegistry.apps[0],
          description: '## Handoff\n\nShare files.',
          category: 'files',
          thumbnailUrl: 'https://apps.example.com/assets/handoff/thumbnail.png',
          iconUrl: 'https://apps.example.com/assets/handoff/icon.png',
          screenshots: [
            'https://apps.example.com/assets/handoff/screenshots/01.png',
            'https://apps.example.com/assets/handoff/screenshots/02.png',
          ],
        },
      ],
    };

    const result = validateRegistry(registry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry).toEqual(registry);
    }
  });

  it('rejects mistyped store-presentation fields', () => {
    const result = validateRegistry({
      schemaVersion: 1,
      apps: [
        {
          ...validRegistry.apps[0],
          description: 42,
          category: [],
          thumbnailUrl: {},
          screenshots: 'https://apps.example.com/one.png',
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'apps[0].description: must be string',
          'apps[0].category: must be string',
          'apps[0].thumbnailUrl: must be string',
          'apps[0].screenshots: must be an array of strings',
        ]),
      );
    }
  });

  it('rejects a screenshots array containing a non-string', () => {
    const result = validateRegistry({
      schemaVersion: 1,
      apps: [{ ...validRegistry.apps[0], screenshots: ['https://apps.example.com/one.png', 7] }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('apps[0].screenshots: must be an array of strings');
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

describe('interpolateStep', () => {
  const step = {
    id: 'grant-access',
    title: 'Give other people access',
    body: 'Add each person as a guest on {projectPath}.',
    deepLink: '/repo/{projectPath}/settings?tab=members',
  };

  it('expands every token across title, body and deepLink', () => {
    const result = interpolateStep(
      { ...step, title: 'Access for {projectPath}' },
      { projectPath: 'acme/site', appHost: 'reader.example.com' },
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Access for acme/site');
    expect(result!.body).toBe('Add each person as a guest on acme/site.');
    expect(result!.deepLink).toBe('/repo/acme/site/settings?tab=members');
  });

  it('expands every occurrence of a repeated token', () => {
    const result = interpolateStep(
      { id: 'x', title: 't', body: 'Allow PUT from {appHost} to {appHost}.' },
      { appHost: 'a.example.com' },
    );

    expect(result).not.toBeNull();
    expect(result!.body).toBe('Allow PUT from a.example.com to a.example.com.');
  });

  it('leaves a step with no tokens untouched', () => {
    const plain = { id: 'x', title: 'Title', body: 'Body.', deepLink: '/domains' };

    const result = interpolateStep(plain, { projectPath: 'acme/site' });
    expect(result).toEqual(plain);
  });

  it('drops a sentence whose token has no value rather than emitting a literal brace', () => {
    const result = interpolateStep(
      { id: 'x', title: 'T', body: 'First sentence. Allow PUT from {appHost}. Last sentence.' },
      {},
    );

    expect(result).not.toBeNull();
    expect(result!.body).toBe('First sentence. Last sentence.');
    expect(result!.body).not.toContain('{appHost}');
  });

  it('omits deepLink entirely when it depends on a token with no value', () => {
    const result = interpolateStep(
      { id: 'x', title: 'T', body: 'B', deepLink: '/repo/{projectPath}/settings' },
      {},
    );

    expect(result).not.toBeNull();
    expect(result!.deepLink).toBeUndefined();
  });

  it('does not mutate the input step', () => {
    const original = { id: 'x', title: 'T', body: 'On {projectPath}.' };
    interpolateStep(original, { projectPath: 'acme/site' });

    expect(original.body).toBe('On {projectPath}.');
  });

  it('returns null when title has an unresolvable token', () => {
    const result = interpolateStep(
      { id: 'x', title: 'Configure on {projectPath}', body: 'B' },
      {},
    );

    expect(result).toBeNull();
  });

  it('returns a step when title tokens all resolve', () => {
    const result = interpolateStep(
      { id: 'x', title: 'Access for {projectPath}', body: 'B' },
      { projectPath: 'acme/site' },
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Access for acme/site');
  });

  it('survives when only body has an unresolvable token', () => {
    const result = interpolateStep(
      { id: 'x', title: 'Configure CORS', body: 'Allow PUT from {appHost}. But also configure locally.' },
      {},
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Configure CORS');
    expect(result!.body).toBe('But also configure locally.');
    expect(result!.body).not.toContain('{appHost}');
  });

  it('drops the whole sentence, not just up to an embedded decimal point, leaving no orphan fragment', () => {
    const result = interpolateStep(
      {
        id: 'x',
        title: 'T',
        body: 'Allow PUT from {appHost} for v1.0 clients. Nothing else.',
      },
      {},
    );

    expect(result).not.toBeNull();
    expect(result!.body).toBe('Nothing else.');
    expect(result!.body).not.toContain('0 clients');
    expect(result!.body).not.toContain('{appHost}');
  });
});
