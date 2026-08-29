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
import { runInit } from './commands/init.js';
import { runLogin, runLogout, runAuthStatus, runAuthToken } from './commands/auth.js';

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
  .description('Proxy rule sets as code (init, build, validate, test, pull, push, diff, revisions, rollback, dev)');

/** Commander option collector for repeatable flags. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

rules
  .command('init')
  .description(
    'Scaffold authoring files in a rule-set directory. Currently: --schema <name> writes ' +
      'schemas/<name>.schema.yaml — schemas sync by name on `rules push` (created in the ' +
      'project when missing), so no pre-created server id is needed.',
  )
  .argument('[dir]', 'rule-set directory (defaults to the single .bffless/config.json ruleSets match)')
  .option('--schema <name>', 'generate schemas/<name>.schema.yaml')
  .option('--kind <kind>', 'declare what the schema is for: upload|chat|state')
  .option(
    '--field <name:type[:required]>',
    'schema field, repeatable; types: string|number|boolean|email|text|datetime|json',
    collect,
    [],
  )
  .option('--force', 'overwrite an existing file')
  .action((dir: string | undefined, opts: { schema?: string; field?: string[]; force?: boolean }) => {
    const result = runInit(dir, opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(result.outFile);
    if (result.hint) console.log(result.hint);
  });

rules
  .command('build')
  .description('Compile an authoring rule-set directory to a canonical export JSON')
  .argument('[dirs...]', 'rule-set directories (defaults to .bffless/config.json ruleSets)')
  .option('-o, --output <file>', 'output file path (only valid with a single resolved rule set)')
  .option(
    '--path-prefix <prefix>',
    'prepend a literal prefix to every derived pathPattern (explicit pathPattern: manifests are left verbatim), e.g. /api/hello (spec: workflow implementations)',
  )
  .action(async (dirs: string[], opts: { output?: string; pathPrefix?: string }) => {
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
      const result = await buildOne(dir, { output: opts.output, pathPrefix: opts.pathPrefix });
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
  .option(
    '--adopt-fields',
    'append new optional fields from *.schema.yaml onto a live schema this set owns (default: warn only; never removes, retypes or requires a field)',
  )
  .option('--name-suffix <suffix>', 'rename the set to <name>-<suffix> before syncing (e.g. pr-42 previews)')
  .option(
    '--path-prefix <prefix>',
    'prepend a literal prefix to every derived pathPattern (explicit pathPattern: manifests are left verbatim), e.g. /api/hello (spec: workflow implementations)',
  )
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
        adoptFields?: boolean;
        nameSuffix?: string;
        pathPrefix?: string;
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
  .option(
    '--path-prefix <prefix>',
    'prepend a literal prefix to every derived pathPattern (explicit pathPattern: manifests are left verbatim), e.g. /api/hello (spec: workflow implementations)',
  )
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .option('--api-key <key>', 'API key (overrides BFFLESS_API_KEY; sent as X-API-Key)')
  .option('--project <idOrName>', 'project UUID, owner/name, or name (overrides config project)')
  .action(async (dirs: string[], opts: { pathPrefix?: string; apiUrl?: string; apiKey?: string; project?: string }) => {
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

program
  .command('login')
  .description(
    'Store an API key for a BFFless instance in ~/.config/bffless/credentials.json ' +
      '(paste-a-key; validated against the instance before saving). All commands then ' +
      'use it automatically when --api-key/BFFLESS_API_KEY are absent.',
  )
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .action(async (opts: { apiUrl?: string }) => {
    const result = await runLogin(opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(`stored credentials for ${result.apiUrl}`);
  });

program
  .command('logout')
  .description('Remove the stored API key for a BFFless instance')
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .action((opts: { apiUrl?: string }) => {
    const result = runLogout(opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(
      result.removed
        ? `removed credentials for ${result.apiUrl}`
        : `no stored credentials for ${result.apiUrl} — nothing to remove`,
    );
  });

const auth = program
  .command('auth')
  .description('Inspect the credential store written by `bffless login` (status, token)');

auth
  .command('status')
  .description('List stored instances (key prefix only) and whether each key still validates')
  .action(async () => {
    const rows = await runAuthStatus();
    if (rows.length === 0) {
      console.log('no stored credentials — run `bffless login`');
      return;
    }
    for (const row of rows) {
      console.log(`${row.apiUrl}  ${row.keyPrefix}  ${row.valid ? 'valid' : 'INVALID'}`);
    }
    if (rows.some((r) => !r.valid)) process.exitCode = 1;
  });

auth
  .command('token')
  .description(
    'Print the stored API key for the resolved instance to stdout (pipe-safe), e.g. ' +
      'curl -H "X-API-Key: $(bffless auth token)" …',
  )
  .option('--api-url <url>', 'API base URL (overrides BFFLESS_API_URL and config apiUrl)')
  .action((opts: { apiUrl?: string }) => {
    const result = runAuthToken(opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(result.token);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
