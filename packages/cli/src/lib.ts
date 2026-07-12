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
export { runPushOne, formatSyncReport } from './commands/push.js';
export type { PushOptions, PushOutcome, PushDeps } from './commands/push.js';
export { runDiffOne } from './commands/diff.js';
export type { DiffOptions, DiffOutcome } from './commands/diff.js';
export { decompileExport, writeDecompiled } from './compile/decompile.js';
export { canonicalizeExport, stringifyExport, exportsEquivalent } from './format/canonical.js';
export type { RuleSetExport, ExportedRule, ExportedSchema } from './format/types.js';
export type { SyncRequestBody, SyncResponse, SyncRuleRef, SyncSchemaResolution } from './api/sync-types.js';
export { ApiClient, createClient, ApiError } from './api/client.js';
export type { ClientDeps, FetchLike } from './api/client.js';
