/**
 * `.bffless/config.json` discovery + rule-set directory resolution.
 *
 * Config walk-up: `findConfig` walks UP from `cwd` looking for `.bffless/config.json`,
 * validates it against `BfflessConfigSchema`, and returns the *first* (nearest) one found.
 *
 * `resolveRuleSetDirs` decides which rule-set directories a command should operate on:
 * explicit CLI args win outright; otherwise the nearest config's `ruleSets` globs are
 * expanded. The globs in practice are simple (`.bffless/proxy-rules` + a trailing `*`,
 * or `apps` + `*` + `.bffless/proxy-rules` + a trailing `*`) — a single `*` per path
 * segment, no `**`, braces, etc. We use `node:fs`'s native `globSync` when the running
 * Node exposes it (added
 * unflagged in Node 22; not yet in this package's `@types/node` pin, hence the
 * `unknown`-cast feature probe below) and fall back to a small hand-rolled matcher
 * otherwise, so the CLI keeps working on Node 18/20.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as fsModule from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const BfflessConfigSchema = z
  .object({
    apiUrl: z.string().optional(),
    project: z.string().optional(),
    ruleSets: z.array(z.string()).optional(),
  })
  .strict();
export type BfflessConfig = z.infer<typeof BfflessConfigSchema>;

/** Formats a zod issue path (mixed string/number segments) as `a.b[0].c`. */
function formatIssuePath(segments: (string | number)[]): string {
  let out = '';
  for (const segment of segments) {
    out += typeof segment === 'number' ? `[${segment}]` : out.length > 0 ? `.${segment}` : segment;
  }
  return out;
}

/**
 * Walk up from `cwd` looking for `.bffless/config.json`. Returns the nearest one found
 * (parsed + validated against `BfflessConfigSchema`), or `null` if none exists between
 * `cwd` and the filesystem root. Throws if a `.bffless/config.json` is found but is
 * invalid JSON or fails schema validation — an existing-but-broken config should not be
 * silently treated as "no config".
 */
export function findConfig(cwd: string): { path: string; config: BfflessConfig } | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, '.bffless', 'config.json');
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf8');
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`${candidate}: invalid JSON — ${(err as Error).message}`);
      }
      const result = BfflessConfigSchema.safeParse(data);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => {
            const p = formatIssuePath(issue.path);
            return p.length > 0 ? `${p} — ${issue.message}` : issue.message;
          })
          .join('; ');
        throw new Error(`${candidate}: ${issues}`);
      }
      return { path: candidate, config: result.data };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Escapes regex-special characters other than `*`, then turns each `*` into `.*`. */
function segmentToRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Minimal glob matcher: splits `pattern` on `/` and matches each segment independently
 *  (a segment may contain `*`, matched against a single path component — no `**`,
 *  brace expansion, or `?`/character-class support). Only matches directories, since
 *  `ruleSets` entries always resolve to rule-set directories. */
function minimalGlobSync(root: string, pattern: string): string[] {
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let dirs = [root];
  for (const segment of segments) {
    if (!segment.includes('*')) {
      dirs = dirs.map((d) => path.join(d, segment)).filter((d) => existsSync(d));
      continue;
    }
    const re = segmentToRegExp(segment);
    const next: string[] = [];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory() && re.test(entry.name)) next.push(path.join(d, entry.name));
      }
    }
    dirs = next;
  }
  return dirs;
}

/** Feature-probed `node:fs` `globSync` (Node >=22, unflagged; not in this repo's
 *  `@types/node` pin). `undefined` on older Node. */
const nativeGlobSync = (fsModule as unknown as { globSync?: (pattern: string, opts?: { cwd?: string }) => string[] })
  .globSync;

function expandGlob(root: string, pattern: string): string[] {
  if (typeof nativeGlobSync === 'function') {
    return nativeGlobSync(pattern, { cwd: root }).map((p) => path.resolve(root, p));
  }
  return minimalGlobSync(root, pattern);
}

/**
 * Resolve the rule-set directories a command should operate on.
 *
 * - If `args` is non-empty, each entry is resolved to an absolute path relative to `cwd`
 *   and MUST contain a `ruleset.yaml` — an explicitly-named directory that isn't a rule
 *   set is a hard error (the caller made a mistake, not the glob).
 * - Otherwise, the nearest `.bffless/config.json` (found by walking up from `cwd`) is
 *   loaded and its `ruleSets` glob patterns are expanded, resolved *relative to the
 *   config file's own directory* (the project root that owns `.bffless/`), not `cwd`.
 *   Glob matches that don't contain a `ruleset.yaml` are silently filtered out — globs
 *   are inherently permissive over directory structure (e.g. a `skills` dir sitting
 *   next to rule sets), so filtering rather than erroring here is the useful behavior.
 * - No args and no config (or a config with no/empty `ruleSets`) is a helpful error, not
 *   an empty array — silently validating nothing is never what the caller wants.
 */
export function resolveRuleSetDirs(cwd: string, args: string[]): string[] {
  if (args.length > 0) {
    const dirs = args.map((a) => path.resolve(cwd, a));
    for (const dir of dirs) {
      if (!existsSync(path.join(dir, 'ruleset.yaml'))) {
        throw new Error(`${dir}: not a rule set (no ruleset.yaml)`);
      }
    }
    return dirs;
  }

  const found = findConfig(cwd);
  const ruleSets = found?.config.ruleSets;
  if (!found || !ruleSets || ruleSets.length === 0) {
    const hint = found ? `no "ruleSets" configured in ${found.path}` : `no .bffless/config.json found above ${cwd}`;
    throw new Error(
      `No rule set directories to validate (${hint}). Pass one or more directory paths, ` +
        `or add a "ruleSets" array of glob patterns to .bffless/config.json.`,
    );
  }

  const configDir = path.dirname(path.dirname(found.path)); // .../<configDir>/.bffless/config.json
  const dirs = new Set<string>();
  for (const pattern of ruleSets) {
    for (const dir of expandGlob(configDir, pattern)) {
      if (existsSync(path.join(dir, 'ruleset.yaml'))) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}
