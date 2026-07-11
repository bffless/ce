#!/usr/bin/env node
import { Command } from 'commander';
import { resolveRuleSetDirs } from './config.js';
import { buildOne } from './commands/build.js';
import { validateRuleSet, type Issue } from './commands/validate.js';
import { runFnTests } from './commands/test.js';
import { runPull } from './commands/pull.js';

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
const rules = program.command('rules').description('Proxy rule sets as code (build, validate, test, pull)');

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
  .description('Pull a rule set (Phase 0: from a local export file only) and decompile it to the authoring layout')
  .option('--from-file <file>', 'path to a RuleSetExport JSON file (required in Phase 0)')
  .option('--decompile', 'decompile the export to the authoring layout (the only supported mode in Phase 0)')
  .option('-o, --output <dir>', 'output directory (default: .bffless/proxy-rules/<ruleSet.name>/)')
  .option('--force', 'overwrite a non-empty output directory')
  .action(async (opts: { fromFile?: string; decompile?: boolean; output?: string; force?: boolean }) => {
    const result = await runPull(opts, process.cwd());
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(result.outDir);
    for (const w of result.warnings ?? []) console.warn(`warning: ${w}`);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
