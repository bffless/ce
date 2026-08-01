export type AppliesWhen =
  | 'always'
  | 'bucketStorage'
  | 'localStorage'
  | 'platformMode'
  | 'selfHosted';

export const APPLIES_WHEN_VALUES: readonly AppliesWhen[] = [
  'always',
  'bucketStorage',
  'localStorage',
  'platformMode',
  'selfHosted',
];

export interface AppManualStep {
  id: string;
  title: string;
  body: string;
  deepLink?: string;
  appliesWhen?: AppliesWhen;
}

export interface AppManifestRequires {
  presignedStorage?: boolean;
  ceMin?: string;
}

export interface AppManifestSchedule {
  name: string;
  cronExpression: string;
  timezone?: string;
  /** Locate the target pipeline rule after sync by (pathPattern, method). */
  targetRulePath: string;
  targetRuleMethod?: string;
}

export interface AppManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  summary?: string;
  /** Free-form store category (e.g. 'files'), shown as a badge in the catalog. */
  category?: string;
  iconUrl?: string;
  docsUrl?: string;
  sourceUrl?: string;
  requires?: AppManifestRequires;
  install: {
    alias: string;
    deployment: { path: string; basePath: string };
    ruleSets: Array<{ file: string; attachToAlias?: boolean }>;
    domain?: { subdomain: string; isPublic?: boolean; isSpa?: boolean };
    schedules?: AppManifestSchedule[];
    manualSteps?: AppManualStep[];
  };
  eject?: {
    repo: string;
    appPath: string;
    deployWorkflow: string;
    variables: string[];
    secrets: string[];
  };
}

export interface AppRegistryEntry {
  id: string;
  name?: string;
  version: string;
  bundleUrl: string;
  sha256: string;
  summary?: string;
  /**
   * Long-form markdown blurb (the store's `apps/<app>/catalog/description.md`).
   * Registry-only — it never travels in the bundled manifest, so an installed
   * app that has dropped out of the registry renders without one.
   */
  description?: string;
  category?: string;
  iconUrl?: string;
  /** Wide (1200x630-ish) card image for the catalog grid. Registry-only. */
  thumbnailUrl?: string;
  /** Absolute https URLs, already ordered by the registry builder. Registry-only. */
  screenshots?: string[];
  docsUrl?: string;
  sourceUrl?: string;
  requires?: AppManifestRequires;
}

export interface AppRegistry {
  schemaVersion: 1;
  apps: AppRegistryEntry[];
}
