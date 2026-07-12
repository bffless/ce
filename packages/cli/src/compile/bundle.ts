/**
 * `.fn.ts` handler bundling core. Compiles a single TypeScript handler entry file (plus any
 * relative imports it pulls in, confined to the rule set directory) into a self-contained
 * IIFE bundle suitable for the `function_handler` runtime (harness `runHandler` / the CE
 * backend's `vm`-sandboxed function runner) — see the "TS handler authoring contract" in the
 * proxy-rules-as-code Phase 3 plan.
 *
 * Contract:
 *  - Imports must be relative (`./`/`../`) and must resolve to a path confined to `setDir`
 *    (both lexically and, once resolved, by realpath — so a symlink placed inside the rule
 *    set dir but pointing outside it is also rejected). Bare specifiers (npm packages,
 *    absolute imports) are a build error.
 *  - The entry must `export default function handler(ctx) {...}` or `export function
 *    handler(ctx) {...}`. An entry with neither is a build-time error (checked via an esbuild
 *    metadata pre-pass — see `detectExports` below — rather than deferred to a confusing
 *    `handler === undefined` failure at run time).
 *  - The final bundled string is always run through `validateHandlerSource` (parity contract
 *    with the backend `function-runner.service.ts` prohibited-pattern lint); any findings
 *    fail the bundle with a message listing them (file + line).
 *  - `bundle: true, write: false, format: 'iife', globalName: '__bfflessHandler',
 *    platform: 'neutral', target: 'es2020'`, esbuild's async `build()` API only — plugins
 *    (needed for the confinement `onResolve` hook) do not work with `buildSync`.
 *
 * Never byte-golden the bundled output: exact esbuild-generated text varies across esbuild
 * versions (helper names, whitespace, wrapping) even when the confinement/lint contract is
 * unchanged. Assert behaviorally instead (lint-clean, executes via the harness, returns the
 * expected value).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';
import { resolveConfinedPath, assertRealpathConfined } from './build.js';
import { validateHandlerSource } from '../lint/patterns.js';

export interface BundleOptions {
  /** Attach an inline source map to the bundled string (harness/dev use only — never emit
   *  this for pushed/deployed output). Default false. */
  sourcemap?: boolean;
}

export interface BundleOutcome {
  code: string;
  warnings: string[];
}

/** Appended after the bundled IIFE so the sandboxed runtime's `typeof handler === 'function'`
 *  check (harness `run-handler.ts`, backend `function-runner.service.ts`) sees a top-level
 *  `handler` regardless of whether the author used a default or named export. */
const HANDLER_TAIL = '\nvar handler = __bfflessHandler.default || __bfflessHandler.handler;';

/**
 * Candidate specifiers to try resolving, in order, for a relative import `specifier`:
 *  1. the specifier as written (covers extensionless imports resolved by esbuild's default
 *     rules, and any other literal extension),
 *  2. `<base>.ts`,
 *  3. `<base>.js`,
 * where `<base>` strips a trailing `.ts`/`.js` if present. This lets an author write either
 * extensionless imports (`./util`) or the NodeNext-style `.js`-referring-to-`.ts` convention
 * this very codebase uses (`from '../format/manifest.js'`, a `.ts` file on disk) — both
 * resolve to the same `.ts` source.
 */
function candidatesFor(specifier: string): string[] {
  const ext = path.extname(specifier);
  const base = ext === '.ts' || ext === '.js' ? specifier.slice(0, -ext.length) : specifier;
  return [...new Set([specifier, `${base}.ts`, `${base}.js`])];
}

/**
 * esbuild plugin enforcing the "relative imports only, confined to `setDir`" rule for every
 * non-entry import. Bare specifiers are rejected outright; relative specifiers are resolved
 * against the importer's directory using the exported `resolveConfinedPath` (lexical escape
 * check) and, once a candidate file is found to exist, `assertRealpathConfined` (symlink
 * escape check) from `compile/build.ts` — the same confinement helpers `buildRuleSet` uses
 * for `$file:`/`code:` refs, so a rule set author gets one consistent confinement story.
 */
function confinementPlugin(setDir: string): Plugin {
  return {
    name: 'bffless-confine',
    setup(pluginBuild: PluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        // Let esbuild resolve the entry point itself normally; only imports encountered
        // while bundling are subject to the relative-only / confinement rule.
        if (args.kind === 'entry-point') return undefined;

        if (!args.path.startsWith('./') && !args.path.startsWith('../')) {
          return {
            errors: [
              {
                text: `only relative imports within the rule-set directory are supported in .fn.ts handlers (got "${args.path}")`,
              },
            ],
          };
        }

        const importerDir = path.dirname(args.importer);
        let resolved: string | undefined;
        for (const candidate of candidatesFor(args.path)) {
          let full: string;
          try {
            full = resolveConfinedPath(setDir, importerDir, args.importer, candidate);
          } catch (e) {
            return { errors: [{ text: (e as Error).message }] };
          }
          if (existsSync(full)) {
            resolved = full;
            break;
          }
        }
        if (!resolved) {
          return {
            errors: [{ text: `cannot resolve import "${args.path}" from ${args.importer} (tried .ts, .js)` }],
          };
        }

        // Lexical confinement passed above (else resolveConfinedPath would have thrown); now
        // check the resolved file's realpath in case it's a symlink escaping setDir.
        assertRealpathConfined(setDir, args.importer, resolved, args.path);

        return { path: resolved };
      });
    },
  };
}

/** Detect whether the entry file has a `default` or named `handler` export, without regard
 *  to bundled imports. esbuild's metafile only reports `exports` for ESM-format outputs (an
 *  `iife` bundle has none, since it isn't a module), so this runs a throwaway ESM-format
 *  build purely to read `metafile.outputs[...].exports` — cheaper and clearer than deferring
 *  to a confusing `handler === undefined` failure at run time. Shares the confinement plugin
 *  so bare-import/escape errors surface here too (same errors the real bundle would raise). */
async function detectExports(entryFile: string, setDir: string): Promise<string[]> {
  const result = await build({
    entryPoints: [entryFile],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    metafile: true,
    logLevel: 'silent',
    plugins: [confinementPlugin(setDir)],
  });
  const outputs = Object.values(result.metafile.outputs);
  return outputs[0]?.exports ?? [];
}

/**
 * Bundle a `.fn.ts` handler entry file into a self-contained, sandbox-runnable string.
 *
 * @param entryFile absolute path to the `.fn.ts` entry (must be confined to `setDir`).
 * @param setDir the rule set directory imports are confined to.
 * @param opts.sourcemap attach an inline source map (harness/dev only).
 */
export async function bundleHandler(entryFile: string, setDir: string, opts: BundleOptions = {}): Promise<BundleOutcome> {
  const absEntry = path.resolve(entryFile);
  if (!existsSync(absEntry)) {
    throw new Error(`bundleHandler: entry file not found: ${entryFile}`);
  }
  const relEntry = path.relative(setDir, absEntry);
  if (relEntry === '..' || relEntry.startsWith('..' + path.sep) || path.isAbsolute(relEntry)) {
    throw new Error(`bundleHandler: entry file is outside the rule set directory: ${entryFile}`);
  }
  assertRealpathConfined(setDir, entryFile, absEntry, entryFile);

  const exportedNames = await detectExports(absEntry, setDir);
  if (!exportedNames.includes('default') && !exportedNames.includes('handler')) {
    throw new Error(
      `${entryFile}: no default or named "handler" export found. A .fn.ts entry must ` +
        '`export default function handler(ctx) {...}` or `export function handler(ctx) {...}`.',
    );
  }

  const result = await build({
    entryPoints: [absEntry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__bfflessHandler',
    platform: 'neutral',
    target: 'es2020',
    sourcemap: opts.sourcemap ? 'inline' : false,
    logLevel: 'silent',
    plugins: [confinementPlugin(setDir)],
  });

  const warnings = result.warnings.map((w) => w.text);
  const code = result.outputFiles[0].text + HANDLER_TAIL;

  const findings = validateHandlerSource(code);
  if (findings.length > 0) {
    const listed = findings.map((f) => `  ${entryFile}:${f.line}:${f.column} ${f.message}`).join('\n');
    throw new Error(`bundleHandler: bundled output for ${entryFile} failed validation:\n${listed}`);
  }

  return { code, warnings };
}
