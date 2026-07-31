import { compareSemver } from './ce-version.util';
import {
  APPLIES_WHEN_VALUES,
  type AppManifest,
  type AppManualStep,
  type AppRegistry,
} from './app-manifest.types';

/** Copied from apps/backend/src/domains/domains.service.ts:27-46 (not exported there).
 * Keep in sync if that list changes. */
const RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'mail',
  'ftp',
  'smtp',
  'pop',
  'imap',
  'dns',
  'ns',
  'mx',
  'localhost',
  'staging',
  'dev',
  'test',
  'prod',
  'production',
  'minio',
];

const ID_PATTERN = /^[a-z0-9-]+$/;
// Matches CreateAliasDto/CreateDeploymentZipDto's alias rule.
const ALIAS_PATTERN = /^[a-zA-Z0-9_-]+$/;
// Matches CreateDomainDto's path rule.
const BASE_PATH_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;
const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RULE_SET_FILE_PATTERN = /^rulesets\/[a-zA-Z0-9._-]+\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isParseableSemver(value: string): boolean {
  return Number.isFinite(compareSemver(value, value));
}

function validateManifestRequires(requires: unknown, path: string, errors: string[]): void {
  if (requires === undefined) return;
  if (!isPlainObject(requires)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (requires.presignedStorage !== undefined && typeof requires.presignedStorage !== 'boolean') {
    errors.push(`${path}.presignedStorage: must be boolean`);
  }
  if (requires.ceMin !== undefined) {
    if (typeof requires.ceMin !== 'string') {
      errors.push(`${path}.ceMin: must be a string`);
    } else if (!isParseableSemver(requires.ceMin)) {
      errors.push(`${path}.ceMin: must be a parseable semver string`);
    }
  }
}

function validateRuleSets(ruleSets: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(ruleSets) || ruleSets.length === 0) {
    errors.push(`${path}: required non-empty array`);
    return;
  }
  ruleSets.forEach((entry, i) => {
    const entryPath = `${path}[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.file)) {
      errors.push(`${entryPath}.file: required string`);
    } else if (entry.file.includes('..') || !RULE_SET_FILE_PATTERN.test(entry.file)) {
      errors.push(
        `${entryPath}.file: must be a relative path matching /^rulesets\\/[a-zA-Z0-9._-]+\\.json$/ with no ".."`,
      );
    }
    if (entry.attachToAlias !== undefined && typeof entry.attachToAlias !== 'boolean') {
      errors.push(`${entryPath}.attachToAlias: must be boolean`);
    }
  });
}

function validateDomain(domain: unknown, path: string, errors: string[]): void {
  if (domain === undefined) return;
  if (!isPlainObject(domain)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (!isNonEmptyString(domain.subdomain)) {
    errors.push(`${path}.subdomain: required string`);
  } else if (!SUBDOMAIN_PATTERN.test(domain.subdomain)) {
    errors.push(`${path}.subdomain: must match /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`);
  } else if (RESERVED_SUBDOMAINS.includes(domain.subdomain)) {
    errors.push(`${path}.subdomain: is a reserved subdomain`);
  }
  if (domain.isPublic !== undefined && typeof domain.isPublic !== 'boolean') {
    errors.push(`${path}.isPublic: must be boolean`);
  }
  if (domain.isSpa !== undefined && typeof domain.isSpa !== 'boolean') {
    errors.push(`${path}.isSpa: must be boolean`);
  }
}

function validateSchedules(schedules: unknown, path: string, errors: string[]): void {
  if (schedules === undefined) return;
  if (!Array.isArray(schedules)) {
    errors.push(`${path}: must be an array`);
    return;
  }
  schedules.forEach((entry, i) => {
    const entryPath = `${path}[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.name)) {
      errors.push(`${entryPath}.name: required string`);
    }
    if (!isNonEmptyString(entry.cronExpression)) {
      errors.push(`${entryPath}.cronExpression: required string`);
    }
    if (entry.timezone !== undefined && typeof entry.timezone !== 'string') {
      errors.push(`${entryPath}.timezone: must be string`);
    }
    if (!isNonEmptyString(entry.targetRulePath)) {
      errors.push(`${entryPath}.targetRulePath: required string`);
    }
    if (entry.targetRuleMethod !== undefined && typeof entry.targetRuleMethod !== 'string') {
      errors.push(`${entryPath}.targetRuleMethod: must be string`);
    }
  });
}

function validateManualSteps(manualSteps: unknown, path: string, errors: string[]): void {
  if (manualSteps === undefined) return;
  if (!Array.isArray(manualSteps)) {
    errors.push(`${path}: must be an array`);
    return;
  }
  manualSteps.forEach((entry, i) => {
    const entryPath = `${path}[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      errors.push(`${entryPath}.id: required string`);
    }
    if (!isNonEmptyString(entry.title)) {
      errors.push(`${entryPath}.title: required string`);
    }
    if (!isNonEmptyString(entry.body)) {
      errors.push(`${entryPath}.body: required string`);
    }
    if (entry.deepLink !== undefined && typeof entry.deepLink !== 'string') {
      errors.push(`${entryPath}.deepLink: must be string`);
    }
    if (
      entry.appliesWhen !== undefined &&
      !APPLIES_WHEN_VALUES.includes(entry.appliesWhen as (typeof APPLIES_WHEN_VALUES)[number])
    ) {
      errors.push(`${entryPath}.appliesWhen: must be one of ${APPLIES_WHEN_VALUES.join(', ')}`);
    }
  });
}

function validateInstall(install: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(install)) {
    errors.push(`${path}: required object`);
    return;
  }

  if (!isNonEmptyString(install.alias)) {
    errors.push(`${path}.alias: required string`);
  } else if (!ALIAS_PATTERN.test(install.alias)) {
    errors.push(`${path}.alias: must match /^[a-zA-Z0-9_-]+$/`);
  }

  const deployment = install.deployment;
  const deploymentPath = `${path}.deployment`;
  if (!isPlainObject(deployment)) {
    errors.push(`${deploymentPath}: required object`);
  } else {
    if (!isNonEmptyString(deployment.path)) {
      errors.push(`${deploymentPath}.path: required string`);
    }
    if (!isNonEmptyString(deployment.basePath)) {
      errors.push(`${deploymentPath}.basePath: required string`);
    } else if (!BASE_PATH_PATTERN.test(deployment.basePath)) {
      errors.push(`${deploymentPath}.basePath: must match /^\\/[a-zA-Z0-9/_-]*$/`);
    }
  }

  validateRuleSets(install.ruleSets, `${path}.ruleSets`, errors);
  validateDomain(install.domain, `${path}.domain`, errors);
  validateSchedules(install.schedules, `${path}.schedules`, errors);
  validateManualSteps(install.manualSteps, `${path}.manualSteps`, errors);
}

function validateEject(eject: unknown, path: string, errors: string[]): void {
  if (eject === undefined) return;
  if (!isPlainObject(eject)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (!isNonEmptyString(eject.repo)) {
    errors.push(`${path}.repo: required string`);
  }
  if (!isNonEmptyString(eject.appPath)) {
    errors.push(`${path}.appPath: required string`);
  }
  if (!isNonEmptyString(eject.deployWorkflow)) {
    errors.push(`${path}.deployWorkflow: required string`);
  }
  if (!Array.isArray(eject.variables) || !eject.variables.every((v) => typeof v === 'string')) {
    errors.push(`${path}.variables: required string[]`);
  }
  if (!Array.isArray(eject.secrets) || !eject.secrets.every((v) => typeof v === 'string')) {
    errors.push(`${path}.secrets: required string[]`);
  }
}

export function validateAppManifest(
  json: unknown,
): { ok: true; manifest: AppManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(json)) {
    return { ok: false, errors: ['root: must be an object'] };
  }

  if (json.schemaVersion !== 1) {
    errors.push('schemaVersion: must be 1');
  }

  if (!isNonEmptyString(json.id)) {
    errors.push('id: required string');
  } else if (!ID_PATTERN.test(json.id)) {
    errors.push('id: must match /^[a-z0-9-]+$/');
  }

  if (!isNonEmptyString(json.name)) {
    errors.push('name: required string');
  }

  if (!isNonEmptyString(json.version)) {
    errors.push('version: required string');
  } else if (!isParseableSemver(json.version)) {
    errors.push('version: must be a parseable semver string');
  }

  if (json.summary !== undefined && typeof json.summary !== 'string') {
    errors.push('summary: must be string');
  }
  if (json.iconUrl !== undefined && typeof json.iconUrl !== 'string') {
    errors.push('iconUrl: must be string');
  }
  if (json.docsUrl !== undefined && typeof json.docsUrl !== 'string') {
    errors.push('docsUrl: must be string');
  }
  if (json.sourceUrl !== undefined && typeof json.sourceUrl !== 'string') {
    errors.push('sourceUrl: must be string');
  }

  validateManifestRequires(json.requires, 'requires', errors);
  validateInstall(json.install, 'install', errors);
  validateEject(json.eject, 'eject', errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, manifest: json as unknown as AppManifest };
}

export function validateRegistry(
  json: unknown,
): { ok: true; registry: AppRegistry } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(json)) {
    return { ok: false, errors: ['root: must be an object'] };
  }

  if (json.schemaVersion !== 1) {
    errors.push('schemaVersion: must be 1');
  }

  if (!Array.isArray(json.apps)) {
    errors.push('apps: must be an array');
  } else {
    json.apps.forEach((entry, i) => {
      const path = `apps[${i}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.id)) {
        errors.push(`${path}.id: required string`);
      } else if (!ID_PATTERN.test(entry.id)) {
        errors.push(`${path}.id: must match /^[a-z0-9-]+$/`);
      }
      if (entry.name !== undefined && typeof entry.name !== 'string') {
        errors.push(`${path}.name: must be string`);
      }
      if (!isNonEmptyString(entry.version)) {
        errors.push(`${path}.version: required string`);
      } else if (!isParseableSemver(entry.version)) {
        errors.push(`${path}.version: must be a parseable semver string`);
      }
      if (!isNonEmptyString(entry.bundleUrl)) {
        errors.push(`${path}.bundleUrl: required string`);
      } else if (!/^https:\/\//.test(entry.bundleUrl)) {
        errors.push(`${path}.bundleUrl: must be an https: URL`);
      }
      if (!isNonEmptyString(entry.sha256)) {
        errors.push(`${path}.sha256: required string`);
      } else if (!SHA256_PATTERN.test(entry.sha256)) {
        errors.push(`${path}.sha256: must match /^[a-f0-9]{64}$/i`);
      }
      if (entry.summary !== undefined && typeof entry.summary !== 'string') {
        errors.push(`${path}.summary: must be string`);
      }
      if (entry.iconUrl !== undefined && typeof entry.iconUrl !== 'string') {
        errors.push(`${path}.iconUrl: must be string`);
      }
      if (entry.docsUrl !== undefined && typeof entry.docsUrl !== 'string') {
        errors.push(`${path}.docsUrl: must be string`);
      }
      if (entry.sourceUrl !== undefined && typeof entry.sourceUrl !== 'string') {
        errors.push(`${path}.sourceUrl: must be string`);
      }
      validateManifestRequires(entry.requires, `${path}.requires`, errors);
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, registry: json as unknown as AppRegistry };
}

export function manualStepApplies(
  step: AppManualStep,
  ctx: { bucketStorage: boolean; platformMode: boolean },
): boolean {
  switch (step.appliesWhen ?? 'always') {
    case 'always':
      return true;
    case 'bucketStorage':
      return ctx.bucketStorage;
    case 'localStorage':
      return !ctx.bucketStorage;
    case 'platformMode':
      return ctx.platformMode;
    case 'selfHosted':
      return !ctx.platformMode;
  }
}
