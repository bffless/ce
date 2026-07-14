/**
 * Library entry point (`bffless/lib`) — a pure re-export barrel with no side effects.
 * Unlike `./` (`dist/index.js`), which runs `program.parseAsync()` at module top level,
 * importing this module never executes commander or any CLI command. Safe to ncc-bundle
 * into a GitHub Action.
 */
export { buildRuleSet } from './compile/build.js';
export type { BuildResult } from './compile/build.js';
export { bundleHandler } from './compile/bundle.js';
export type { BundleOptions, BundleOutcome } from './compile/bundle.js';
export { buildOne } from './commands/build.js';
export type { BuildOutcome } from './commands/build.js';
export { validateRuleSet } from './commands/validate.js';
export type { Issue } from './commands/validate.js';
export { runFnTests } from './commands/test.js';
export { runPushOne, formatSyncReport, applyNameSuffix } from './commands/push.js';
export type { PushOptions, PushOutcome, PushDeps } from './commands/push.js';
export { runDiffOne } from './commands/diff.js';
export type { DiffOptions, DiffOutcome } from './commands/diff.js';
export { runRevisionsList, formatRevisionsTable } from './commands/revisions.js';
export type { RevisionsOptions, RevisionsOutcome } from './commands/revisions.js';
export { runRollback, pickDefaultRollbackTarget } from './commands/rollback.js';
export type { RollbackOptions, RollbackOutcome } from './commands/rollback.js';
export { runDev } from './commands/dev.js';
export type { DevOptions, DevDeps, DevWatcher } from './commands/dev.js';
export { decompileExport, writeDecompiled } from './compile/decompile.js';
export { canonicalizeExport, stringifyExport, exportsEquivalent } from './format/canonical.js';
export type { RuleSetExport, ExportedRule, ExportedSchema } from './format/types.js';
export type {
  SyncRequestBody,
  SyncResponse,
  SyncRuleRef,
  SyncSchemaResolution,
  RevisionSource,
  RevisionListItem,
  RevisionListResponse,
  RevisionDetailResponse,
} from './api/sync-types.js';
export { ApiClient, createClient, ApiError } from './api/client.js';
export type { ClientDeps, FetchLike } from './api/client.js';
export { CLI_REMEDIATION, resolveRemediation } from './api/remediation.js';
export type { Remediation } from './api/remediation.js';
