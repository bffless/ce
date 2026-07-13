#!/usr/bin/env node
import { Command } from 'commander';
import { resolveRuleSetDirs } from './config.js';
import { buildOne } from './commands/build.js';
import { validateRuleSet, type Issue } from './commands/validate.js';
import { runFnTests } from './commands/test.js';
import { runPull } from './commands/pull.js';
import { runPushOne, formatSyncReport } from './commands/push.js';
import { runDiffOne } from './commands/diff.js';
import { runRevisionsList, formatRevisionsTable } from './commands/revisions.js';
import { runRollback } from './commands/rollback.js';
import { runDev, type DevOptions } from './commands/dev.js';

/** `<file>:<line> <message>` when `line` is present, `<file> <message>` otherwise. */
function formatIssue(issue: Issue): string {
  return issue.line !== undefined ? `${issue.file}:${issue.line} ${issue.message}` : `${issue.file} ${issue.message}`;
}

/** Resolve `[dirs...]` via Task 11's config-aware resolution, or print a clean error (no
 *  stack trace) and signal failure to the caller instead of throwing. */
function resolveDirsOrReport(dirs: string[]): string[] | null {
  try {
    return resolveRuleSetDirs(process.cwd(), dirs);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}

const program = new Command('bffless').description('BFFless CLI');
const rules = program
  .command('rules')
  .description('Proxy rule sets as code (build, validate, test, pull, push, diff, revisions, rollback, dev)');

rules
  .command('build')
  .description('Compile an authoring rule-set directory to a canonical export JSON')
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .option('-o, --output <file>', 'output file path (only valid with a single resolved rule set)')
  .action(async (dirs: string[], opts: { output?: string }) => {
    const resolved = resolveDirsOrReport(dirs);
    if (!resolved) {
      process.exitCode = 1;
      return;
    }
    if (opts.output && resolved.length > 1) {
      console.error(`-o requires a single rule set directory (${resolved.length} resolved)`);
      process.exitCode = 1;
      return;
    }

    const multi = resolved.length > 1;
    let ok = true;
    for (const dir of resolved) {
      if (multi) console.log(`\n${dir}:`);
      const result = await buildOne(dir, { output: opts.output });
      if (!result.ok) {
        ok = false;
        console.error(result.summary);
        continue;
      }
      console.log(result.outFile);
      console.log(result.summary);
      for (const w of result.warnings ?? []) console.warn(`warning: ${w}`);
    }
    if (!ok) process.exitCode = 1;
  });

rules
  .command('validate')
  .description('Validate an authoring rule-set directory')
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .action(async (dirs: string[]) => {
    const resolved = resolveDirsOrReport(dirs);
    if (!resolved) {
      process.exitCode = 1;
      return;
    }

    const multi = resolved.length > 1;
    let hasErrors = false;
    for (const dir of resolved) {
      if (multi) console.log(`\n${dir}:`);
      const { errors, warnings } = await validateRuleSet(dir);
      for (const w of warnings) console.warn(`warning: ${formatIssue(w)}`);
      for (const e of errors) console.error(formatIssue(e));
      if (errors.length > 0) hasErrors = true;
    }
    if (hasErrors) process.exitCode = 1;
  });

rules
  .command('test')
  .description('Run declarative handler fixtures (*.fn.test.yaml) for a rule-set directory')
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .action(async (dirs: string[]) => {
    const resolved = resolveDirsOrReport(dirs);
    if (!resolved) {
      process.exitCode = 1;
      return;
    }

    const multi = resolved.length > 1;
    let hasFailures = false;
    for (const dir of resolved) {
      if (multi) console.log(`\n${dir}:`);
      const { passed, failed } = await runFnTests(dir);
      console.log(`${passed} passed, ${failed.length} failed`);
      for (const f of failed) console.error(`${f.file} > ${f.case}: ${f.message}`);
      if (failed.length > 0) hasFailures = true;
    }
    if (hasFailures) process.exitCode = 1;
  });

rules
  .command('pull')
  .description(
    'Pull a rule set from the server (by name) and decompile it to the authoring layout. ' +
      'Alternatively pull from a local export file with --from-file <file> --decompile.',
  )
  .argument('[set-name]', 'rule set name within the configured project (required unless --from-file)')
  .option('--from-file <file>', 'path to a local RuleSetExport JSON file instead of the server')
  .option('--decompile', 'decompile the export to the authoring layout (required with --from-file; live pulls always decompile)')
  .option('-o, --output <dir>', 'output directory (default: .bffless/proxy-rules/<ruleSet.name>/)')
  .option('--force', 'overwrite a non-empty output directory')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(
    async (
      setName: string | undefined,
      opts: {
        fromFile?: string;
        decompile?: boolean;
        output?: string;
        force?: boolean;
        apiUrl?: string;
        apiKey?: string;
        project?: string;
      },
    ) => {
      const result = await runPull(setName, opts, process.cwd());
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      console.log(result.outDir);
      for (const w of result.warnings ?? []) console.warn(`warning: ${w}`);
    },
  );

rules
  .command('push')
  .description(
    'Compile rule-set directories and idempotently sync them to the server ' +
      '(PUT /api/proxy-rule-sets/project/:projectId/sync), printing the change report. ' +
      'Missing secrets are reported as warnings (exit 0); HTTP/compile errors exit 1.',
  )
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .option('--dry-run', 'compute and print the change plan without writing anything')
  .option('--prune', 'delete live rules that are absent from the local rule set')
  .option('--strict-schemas', 'fail when a name-reused schema has mismatched field definitions')
  .option('--name-suffix <suffix>', 'rename the set to <name>-<suffix> before syncing (e.g. pr-42 previews)')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(
    async (
      dirs: string[],
      opts: {
        dryRun?: boolean;
        prune?: boolean;
        strictSchemas?: boolean;
        nameSuffix?: string;
        apiUrl?: string;
        apiKey?: string;
        project?: string;
      },
    ) => {
      const resolved = resolveDirsOrReport(dirs);
      if (!resolved) {
        process.exitCode = 1;
        return;
      }
      const multi = resolved.length > 1;
      let ok = true;
      for (const dir of resolved) {
        if (multi) console.log(`\n${dir}:`);
        const result = await runPushOne(dir, opts, process.cwd());
        if (!result.ok) {
          ok = false;
          console.error(result.error);
          continue;
        }
        console.log(result.report);
      }
      if (!ok) process.exitCode = 1;
    },
  );

rules
  .command('diff')
  .description(
    'Compare local rule-set directories against the live server state (CI drift check). ' +
      'Exit codes: 0 = in sync, 1 = drift (including a set missing on the server), 2 = error ' +
      '(compile/auth/network failure).',
  )
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(async (dirs: string[], opts: { apiUrl?: string; apiKey?: string; project?: string }) => {
    const resolved = resolveDirsOrReport(dirs);
    if (!resolved) {
      process.exitCode = 2;
      return;
    }
    const multi = resolved.length > 1;
    let hasDrift = false;
    let hasError = false;
    for (const dir of resolved) {
      if (multi) console.log(`\n${dir}:`);
      const result = await runDiffOne(dir, opts, process.cwd());
      if (result.status === 'error') {
        hasError = true;
        console.error(result.message);
        continue;
      }
      if (result.status === 'drift') {
        hasDrift = true;
        console.error(result.message);
        for (const d of result.diffs ?? []) console.error(`  ${d}`);
        continue;
      }
      console.log(result.message);
    }
    if (hasError) process.exitCode = 2;
    else if (hasDrift) process.exitCode = 1;
  });

rules
  .command('revisions')
  .description(
    'List captured revisions for a rule set (GET /api/proxy-rule-sets/:id/revisions), newest first.',
  )
  .argument('<set-name>', 'rule set name within the configured project')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(async (setName: string, opts: { apiUrl?: string; apiKey?: string; project?: string }) => {
    const result = await runRevisionsList(setName, opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(formatRevisionsTable(result.revisions ?? []));
  });

rules
  .command('rollback')
  .description(
    'Roll a rule set back to a previously captured revision ' +
      '(POST /api/proxy-rule-sets/:id/rollback/:revisionId), printing the change report ' +
      '(the same shape `rules push` prints — a rollback IS a sync). Defaults to the newest ' +
      'revision with current: false; --to targets a specific revision id instead.',
  )
  .argument('<set-name>', 'rule set name within the configured project')
  .option(
    '--to <revisionId>',
    'revision to roll back to — a full uuid or any unique prefix, e.g. the 8-char id ' +
      '`rules revisions` prints (default: newest non-current revision)',
  )
  .option('--dry-run', 'compute and print the rollback change plan without writing anything')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(
    async (
      setName: string,
      opts: { to?: string; dryRun?: boolean; apiUrl?: string; apiKey?: string; project?: string },
    ) => {
      const result = await runRollback(setName, opts, process.cwd());
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      console.log(formatSyncReport(setName, result.response!));
    },
  );

rules
  .command('dev')
  .description(
    'Watch rule-set directories and rerun build → validate → test on every change ' +
      '(local-only by default — no network). --push additionally syncs a fully green pass ' +
      'to the server, but only when --name-suffix is also given, so a dev loop can never ' +
      'touch the bare-named live set.',
  )
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .option('--push', 'after each fully green pass, sync the changed set to the server (requires --name-suffix)')
  .option('--name-suffix <suffix>', 'rename the set to <name>-<suffix> before syncing (required with --push)')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(async (dirs: string[], opts: DevOptions) => {
    const resolved = resolveDirsOrReport(dirs);
    if (!resolved) {
      process.exitCode = 1;
      return;
    }

    let handle: { close: () => Promise<void> };
    try {
      handle = await runDev(resolved, opts, process.cwd());
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }

    // Long-running: block until Ctrl-C, then close the watcher cleanly and let the
    // process exit naturally (no process.exit — see resolveDirsOrReport's doc comment).
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => {
        handle.close().then(resolve, resolve);
      });
    });
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
