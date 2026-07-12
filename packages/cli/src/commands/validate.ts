/**
 * `rules validate` orchestration: composes the manifest zod schemas, `buildRuleSet`, the
 * `.fn.js` sandbox lint, and the §3.5 skills cross-ref into one pass over a rule-set
 * directory. Command wiring (commander, process.exit) is Task 13 — this module only
 * returns the collected issues.
 *
 * Design note (see task-11 report for the full writeup): `buildRuleSet` is all-or-nothing
 * — it throws on the *first* problem it hits and stops, so a single `buildRuleSet` call
 * can only ever surface one build-time error, even though a rule set can have several
 * independent problems (a bad manifest here, a dangling `code:` ref there, a missing
 * `$schema:` elsewhere). To report all of them in one pass, this module independently
 * re-checks the two file-reference concerns that `buildRuleSet` would otherwise be the
 * sole source of truth for — `code:` ref existence and `$schema:` ref resolution — while
 * walking manifests for zod validation (step 1). `buildRuleSet` (step 2) still runs and
 * is still the authority for everything else (duplicate routes, header-secret leakage,
 * order collisions, etc.); its thrown error is only added as a *new* issue when an
 * identical (file, message) pair isn't already covered by a step-1 finding, so a set
 * with several unrelated problems doesn't drown in duplicate reports of whichever one
 * `buildRuleSet` tripped on first — while a *different* problem on the same file (e.g. a
 * dangling `code:` ref alongside a committed header secret) still surfaces both issues.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  RulesetManifestSchema,
  RuleManifestSchema,
  SchemaManifestSchema,
  parseYamlFile,
} from '../format/manifest.js';
import type { RuleManifest } from '../format/manifest.js';
import { walkSchemaRefs } from '../format/schema-refs.js';
import { METHOD_STEMS } from '../format/routes.js';
import { buildRuleSet, resolveConfinedPath, assertRealpathConfined } from '../compile/build.js';
import { bundleHandler } from '../compile/bundle.js';
import { validateHandlerSource } from '../lint/patterns.js';

export interface Issue {
  file: string;
  message: string;
  line?: number;
}

const RULE_FILE_RE = new RegExp(`^(${[...METHOD_STEMS].join('|')})\\.rule\\.yaml$`);

/** Path to `filePath`, relative to `setDir` (POSIX-normalized-ish via node path.relative). */
function toRel(setDir: string, filePath: string): string {
  const rel = path.relative(setDir, filePath);
  return rel.length > 0 ? rel : '.';
}

/** Same YAML-parse-error-message shape `parseYamlFile` throws, minus the redundant
 *  leading `${filePath}: ` (the caller already records the file separately). */
function stripFilePrefix(filePath: string, message: string): string {
  const prefix = `${filePath}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/** `parseYamlFile`, but collecting failures into `errors` instead of throwing. Returns
 *  the parsed value, or `null` if parsing/validation failed. */
function tryParseYamlFile<T>(filePath: string, schema: ZodType<T>, setDir: string, errors: Issue[]): T | null {
  try {
    return parseYamlFile(filePath, schema);
  } catch (err) {
    const message = (err as Error).message;
    errors.push({ file: toRel(setDir, filePath), message: stripFilePrefix(filePath, message) });
    return null;
  }
}

interface DiscoveredManifest {
  path: string;
  dir: string;
}

/** Recursively find `<stem>.rule.yaml` files and `<stem>/rule.yaml` directory-shape rules
 *  under `rulesDir`, mirroring (a deliberately independent, smaller copy of) the
 *  compiler's `discoverRules` in `compile/build.ts` — validate only needs the manifest
 *  path + its directory, not the full route-derivation bookkeeping. */
function discoverRuleManifests(rulesDir: string, out: DiscoveredManifest[]): void {
  if (!existsSync(rulesDir)) return;
  const entries = readdirSync(rulesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(rulesDir, entry.name);
    if (entry.isFile()) {
      if (RULE_FILE_RE.test(entry.name)) out.push({ path: full, dir: rulesDir });
      continue;
    }
    if (entry.isDirectory()) {
      const ruleYaml = path.join(full, 'rule.yaml');
      if (METHOD_STEMS.has(entry.name) && existsSync(ruleYaml)) {
        out.push({ path: ruleYaml, dir: full });
      } else {
        discoverRuleManifests(full, out);
      }
    }
  }
}

/** Recursively find every `*.fn.js`/`*.fn.ts` file under `dir`. */
function discoverFnFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverFnFiles(full, out);
    } else if (entry.isFile() && /\.fn\.(js|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Lint a `.fn.ts` handler by bundling it first (via `bundleHandler`) — the bundle is what
 *  actually ships, and raw TS source (e.g. `import { leak } from './util.js'`) is invisible
 *  to the prohibited-pattern regexes, which only see the entry file's own text. A clean
 *  bundle is re-linted the normal way (belt-and-suspenders, and future-proof against
 *  `bundleHandler` ever stopping to lint internally); a bundle that fails `bundleHandler`'s
 *  own internal lint-and-throw has its per-finding lines parsed back out of the thrown
 *  message so the reported `Issue`s point at the `.fn.ts` source file, exactly like the
 *  `.fn.js` path reports one `Issue` per finding. */
async function lintTsHandler(fnFile: string, setDir: string, errors: Issue[]): Promise<void> {
  try {
    const { code } = await bundleHandler(fnFile, setDir);
    for (const finding of validateHandlerSource(code)) {
      errors.push({ file: toRel(setDir, fnFile), message: finding.message, line: finding.line });
    }
  } catch (err) {
    const message = (err as Error).message;
    // bundleHandler formats a validation failure as:
    //   bundleHandler: bundled output for <file> failed validation:
    //     <file>:<line>:<col> <message>
    //     <file>:<line>:<col> <message>
    // Parse the indented finding lines back into one Issue per finding.
    const findingLineRe = /^\s*\S+:(\d+):\d+\s+(.+)$/;
    const parsed = message
      .split('\n')
      .slice(1)
      .map((l) => findingLineRe.exec(l))
      .filter((m): m is RegExpExecArray => m !== null);
    if (parsed.length > 0) {
      for (const m of parsed) errors.push({ file: toRel(setDir, fnFile), message: m[2], line: Number(m[1]) });
    } else {
      // Any other bundleHandler failure (e.g. a confinement/import error) — still surface it
      // as a validate finding pointing at the source file, rather than silently swallowing it.
      errors.push({ file: toRel(setDir, fnFile), message });
    }
  }
}

/** authoring `pipeline:` step shape uses `code:`; both authoring (`pipeline:`) and
 *  canonical (`pipelineConfig:`) step shapes are walked the same way here since we only
 *  look at `code`/`handler`/`handlerType`/`config`, which both schemas share the field
 *  names for (`handler` vs `handlerType` is handled explicitly). */
interface ManifestPipelineLike {
  steps?: ManifestStepLike[];
  postSteps?: ManifestStepLike[];
}
interface ManifestStepLike {
  handler?: string;
  handlerType?: string;
  code?: string;
  config?: Record<string, unknown>;
}

/** Checks every step's `code:` ref (authoring-sugar convenience field) resolves to an
 *  existing file relative to `manifestDir`, reusing `buildRuleSet`'s own confinement
 *  guard (`resolveConfinedPath` + `assertRealpathConfined`) rather than a bare
 *  `path.resolve`/`existsSync` pair — otherwise a `code:` ref that lexically or via
 *  symlink escapes `setDir` but happens to resolve to an existing file would pass
 *  `validate` even though `build` would reject it. (Canonical `pipelineConfig` file refs
 *  use `{ $file: ... }` instead, which `buildRuleSet` remains the sole checker for — the
 *  fixture and brief both describe the authoring `code:` sugar specifically.) */
function checkCodeRefs(pipeline: ManifestPipelineLike | undefined, manifestDir: string, manifestPath: string, setDir: string, errors: Issue[]): void {
  if (!pipeline) return;
  for (const steps of [pipeline.steps, pipeline.postSteps]) {
    if (!steps) continue;
    for (const step of steps) {
      if (step.code === undefined) continue;
      let resolved: string;
      try {
        resolved = resolveConfinedPath(setDir, manifestDir, manifestPath, step.code);
      } catch (err) {
        errors.push({ file: toRel(setDir, manifestPath), message: stripFilePrefix(manifestPath, (err as Error).message) });
        continue;
      }
      if (!existsSync(resolved)) {
        errors.push({ file: toRel(setDir, manifestPath), message: `code file not found: ${step.code}` });
        continue;
      }
      try {
        assertRealpathConfined(setDir, manifestPath, resolved, step.code);
      } catch (err) {
        errors.push({ file: toRel(setDir, manifestPath), message: stripFilePrefix(manifestPath, (err as Error).message) });
      }
    }
  }
}

/** Checks every `$schema:<name>` ref (in `schemaId`/etc — see `SCHEMA_REF_KEYS`) resolves
 *  to an existing `schemas/<name>.schema.yaml`. */
function checkSchemaRefs(pipeline: unknown, setDir: string, manifestPath: string, errors: Issue[]): void {
  if (!pipeline) return;
  walkSchemaRefs(pipeline, (ref) => {
    if (!ref.startsWith('$schema:')) return;
    const name = ref.slice('$schema:'.length);
    const schemaPath = path.join(setDir, 'schemas', `${name}.schema.yaml`);
    if (!existsSync(schemaPath)) {
      errors.push({
        file: toRel(setDir, manifestPath),
        message: `schema ref "$schema:${name}" has no manifest (schemas/${name}.schema.yaml)`,
      });
    }
  });
}

/** Collects `ai_handler` steps with `config.skills.mode === 'selected'` skill names into
 *  `into`, recording the (first) manifest that referenced each name for error reporting. */
function collectSkillRefs(pipeline: ManifestPipelineLike | undefined, manifestPath: string, into: Map<string, string>): void {
  if (!pipeline) return;
  for (const steps of [pipeline.steps, pipeline.postSteps]) {
    if (!steps) continue;
    for (const step of steps) {
      const handlerType = step.handler ?? step.handlerType;
      if (handlerType !== 'ai_handler') continue;
      const skills = step.config?.skills as Record<string, unknown> | undefined;
      if (!skills || skills.mode !== 'selected') continue;
      const enabled = skills.enabled;
      if (!Array.isArray(enabled)) continue;
      for (const name of enabled) {
        if (typeof name === 'string' && !into.has(name)) into.set(name, manifestPath);
      }
    }
  }
}

/** Walks up from `setDir` for the `.bffless` directory that contains this rule set's
 *  `proxy-rules/` home, returning `<that .bffless>/skills`, or `null` if `setDir` isn't
 *  nested under a `.bffless/proxy-rules/` directory at all (e.g. a bare fixture/scratch
 *  dir with no surrounding project layout). See task-11 report for why this specific
 *  walk (rather than e.g. "nearest `.bffless` above setDir") was chosen. */
function findSkillsRoot(setDir: string): string | null {
  let dir = path.resolve(setDir);
  for (;;) {
    const parent = path.dirname(dir);
    if (path.basename(dir) === 'proxy-rules' && path.basename(parent) === '.bffless') {
      return path.join(parent, 'skills');
    }
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function validateRuleSet(setDir: string): Promise<{ errors: Issue[]; warnings: Issue[] }> {
  const absSetDir = path.resolve(setDir);
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const rulesetPath = path.join(absSetDir, 'ruleset.yaml');
  if (!existsSync(rulesetPath)) {
    errors.push({ file: '.', message: 'not a rule set (no ruleset.yaml)' });
    return { errors, warnings };
  }
  tryParseYamlFile(rulesetPath, RulesetManifestSchema, absSetDir, errors);

  // Step 1: zod-validate every rule manifest, plus the reference-integrity checks
  // (`code:`/`$schema:` existence) and skill-ref collection that ride along with it —
  // see the module doc comment for why these aren't left solely to `buildRuleSet`.
  const skillRefs = new Map<string, string>();
  const discovered: DiscoveredManifest[] = [];
  discoverRuleManifests(path.join(absSetDir, 'rules'), discovered);
  for (const d of discovered) {
    const manifest = tryParseYamlFile(d.path, RuleManifestSchema, absSetDir, errors);
    if (!manifest) continue;
    const rm = manifest as RuleManifest;
    if (rm.pipeline) {
      checkCodeRefs(rm.pipeline as ManifestPipelineLike, d.dir, d.path, absSetDir, errors);
      checkSchemaRefs(rm.pipeline, absSetDir, d.path, errors);
      collectSkillRefs(rm.pipeline as ManifestPipelineLike, d.path, skillRefs);
    }
    if (rm.pipelineConfig) {
      checkSchemaRefs(rm.pipelineConfig, absSetDir, d.path, errors);
      collectSkillRefs(rm.pipelineConfig as ManifestPipelineLike, d.path, skillRefs);
    }
  }

  const schemasDir = path.join(absSetDir, 'schemas');
  if (existsSync(schemasDir)) {
    for (const entry of readdirSync(schemasDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith('.schema.yaml')) {
        tryParseYamlFile(path.join(schemasDir, entry.name), SchemaManifestSchema, absSetDir, errors);
      }
    }
  }

  // Step 2: buildRuleSet is the compile authority — it catches everything step 1 doesn't
  // (duplicate routes, order collisions, header-secret leakage, method conflicts, …).
  // Its skillRefs (when available) supersede the manifest-derived set above, since
  // they're post-$file-resolution and therefore more accurate.
  let resolvedSkillRefs: string[] = [...skillRefs.keys()];
  try {
    const built = await buildRuleSet(absSetDir);
    resolvedSkillRefs = built.skillRefs;
    for (const w of built.warnings) warnings.push({ file: '.', message: w });
  } catch (err) {
    const message = (err as Error).message;
    const match = /^(.*?):\s/.exec(message);
    let file = '.';
    let text = message;
    if (match) {
      const rel = path.relative(absSetDir, match[1]);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        file = rel;
        text = message.slice(match[0].length);
      }
    }
    // Dedup on the exact (file, message) pair, not file alone — a manifest can have
    // several *distinct* problems (e.g. a committed header secret AND a dangling
    // `code:` ref), and buildRuleSet's thrown error must only be suppressed when an
    // identical issue was already recorded in step 1, not whenever step 1 found *any*
    // issue for that file (which would silently drop a different, possibly
    // security-relevant, error).
    const alreadyKnown = errors.some((e) => e.file === file && e.message === text);
    if (!alreadyKnown) errors.push({ file, message: text });
  }

  // Step 3: sandbox lint over every `.fn.js`/`.fn.ts` under the set, regardless of whether
  // its referencing manifest was itself valid — a bad manifest elsewhere shouldn't hide a
  // real prohibited-pattern violation in unrelated handler code. `.ts` files are bundled
  // first (see `lintTsHandler`) since the bundle — not the raw TS text — is what ships.
  const fnFiles: string[] = [];
  discoverFnFiles(absSetDir, fnFiles);
  fnFiles.sort();
  for (const fnFile of fnFiles) {
    if (fnFile.endsWith('.ts')) {
      await lintTsHandler(fnFile, absSetDir, errors);
      continue;
    }
    const code = readFileSync(fnFile, 'utf8');
    for (const finding of validateHandlerSource(code)) {
      errors.push({ file: toRel(absSetDir, fnFile), message: finding.message, line: finding.line });
    }
  }

  // Step 4 (§3.5): skills cross-ref. Only meaningful when the rule set actually
  // references any skills — a set with no ai_handler `skills.mode: selected` steps
  // shouldn't warn just because it happens to have no `.bffless/skills/` sibling.
  if (resolvedSkillRefs.length > 0) {
    const skillsRoot = findSkillsRoot(absSetDir);
    if (!skillsRoot || !existsSync(skillsRoot)) {
      warnings.push({
        file: '.',
        message: `skills unresolved: no .bffless/skills/ root found for this rule set (referenced: ${resolvedSkillRefs.join(', ')})`,
      });
    } else {
      for (const name of resolvedSkillRefs) {
        if (!existsSync(path.join(skillsRoot, name))) {
          const source = skillRefs.get(name);
          errors.push({
            file: source ? toRel(absSetDir, source) : '.',
            message: `skill "${name}" not found in ${toRel(absSetDir, skillsRoot)}/`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}
