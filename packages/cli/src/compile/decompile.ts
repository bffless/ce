/**
 * Decompiler: a canonical `RuleSetExport` → the authoring layout (`ruleset.yaml` + `rules/` +
 * `schemas/`). Exact inverse of the compiler (src/compile/build.ts) — its output must recompile
 * to the same export. See task-7 brief for the binding 7-point behavior spec.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { patternToRelPath, deriveOrders, UUID_RE, defaultPipelineName } from '../format/routes.js';
import { elideRuleDefaults } from '../format/defaults.js';
import { walkSchemaRefs } from '../format/schema-refs.js';
import { canonicalizeExport } from '../format/canonical.js';
import type {
  RuleSetExport,
  ExportedRule,
  PipelineConfig,
  PipelineStep,
} from '../format/types.js';

export interface DecompileResult {
  files: Map<string, string>; // relative path → content
  warnings: string[];
}

/** Emit-order for a rule manifest — readability only; the compiler is order-insensitive. */
const MANIFEST_KEY_ORDER = [
  'pathPattern',
  'methods',
  'targetUrl',
  'stripPrefix',
  'order',
  'timeout',
  'preserveHost',
  'forwardCookies',
  'headerConfig',
  'authTransform',
  'internalRewrite',
  'proxyType',
  'emailHandlerConfig',
  'pipeline',
  'isEnabled',
  'debugEnabled',
  'description',
];

/** YAML with literal block scalars for multiline strings and no line folding (round-trip safety). */
function toYaml(obj: unknown): string {
  return stringifyYaml(obj, { blockQuote: 'literal', lineWidth: 0 });
}

/** Reorder an object's keys per `order` (unlisted keys keep insertion order, appended last). */
function orderKeys(obj: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

/** Filesystem-safe base name for an extracted handler file (step id or name). */
function sanitizeFileBase(s: string): string {
  const out = s.replace(/[^A-Za-z0-9._-]/g, '_');
  return out.length > 0 ? out : 'handler';
}

/** `_custom` slug for an inexpressible pattern: `/`→`-`, `*`→`_star_`, then strip to [A-Za-z0-9._-]. */
function slugForPattern(pattern: string): string {
  const s = pattern.replace(/\//g, '-').replace(/\*/g, '_star_').replace(/[^A-Za-z0-9._-]/g, '');
  return s.length > 0 ? s : 'rule';
}

/** Convert one canonical step into authoring (`handler:`) sugar, extracting function_handler code. */
function stepToSugar(
  step: PipelineStep,
  ruleDirRel: string,
  files: Map<string, string>,
  usedFnNames: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (step.id !== undefined) out.id = step.id;
  if (step.name !== undefined) out.name = step.name;
  out.handler = step.handlerType;

  const config: Record<string, unknown> = { ...(step.config ?? {}) };
  if (step.handlerType === 'function_handler' && typeof config.code === 'string') {
    const code = config.code;
    delete config.code;
    // id/name are both optional; a step with neither still needs a stable filename,
    // and the collision loop below disambiguates if more than one lands on it.
    let base = sanitizeFileBase(step.id ?? step.name ?? 'handler');
    let fname = `${base}.fn.js`;
    let n = 1;
    while (usedFnNames.has(fname)) {
      n++;
      fname = `${base}-${n}.fn.js`;
    }
    usedFnNames.add(fname);
    files.set(path.posix.join(ruleDirRel, fname), code); // byte-verbatim, no newline normalization
    out.code = `./${fname}`;
  }
  if (Object.keys(config).length > 0) out.config = config;
  if (step.isEnabled !== undefined) out.isEnabled = step.isEnabled;
  return out;
}

/** Convert a canonical `pipelineConfig` into authoring `pipeline:` sugar. */
function pipelineToSugar(
  pc: PipelineConfig,
  defaultName: string,
  ruleDirRel: string,
  files: Map<string, string>,
): Record<string, unknown> {
  const usedFnNames = new Set<string>();
  const out: Record<string, unknown> = {};
  if (pc.name !== defaultName) out.name = pc.name; // elide the compiler-derived default name
  if (pc.description !== undefined) out.description = pc.description;
  out.steps = pc.steps.map((s) => stepToSugar(s, ruleDirRel, files, usedFnNames));
  if (pc.postSteps !== undefined) out.postSteps = pc.postSteps.map((s) => stepToSugar(s, ruleDirRel, files, usedFnNames));
  if (pc.validators !== undefined) out.validators = pc.validators;
  return out;
}

export function decompileExport(exp: RuleSetExport): DecompileResult {
  // Work off the canonical form: this strips structural-level nulls (rule/step/pipelineConfig/
  // ruleSet keys) that the authoring YAML schema would reject, normalizes step key order, and
  // gives deterministic rule ordering — see src/format/canonical.ts.
  const canon = canonicalizeExport(exp);
  const files = new Map<string, string>();
  const warnings: string[] = [];

  // 1. ruleset.yaml
  const rs: Record<string, unknown> = { name: canon.ruleSet.name };
  if (canon.ruleSet.description != null) rs.description = canon.ruleSet.description;
  if (canon.ruleSet.environment != null) rs.environment = canon.ruleSet.environment;
  files.set('ruleset.yaml', toYaml(rs));

  // 6. schemas + id→name map for ref rewriting
  const idToName = new Map<string, string>();
  for (const s of canon.schemas ?? []) idToName.set(s.id, s.name);
  for (const s of canon.schemas ?? []) {
    files.set(
      `schemas/${s.name}.schema.yaml`,
      toYaml({ id: s.id, name: s.name, ...(s.kind ? { kind: s.kind } : {}), fields: s.fields }),
    );
  }

  // Derived orders (keyed by the canonical rule objects) for `order:` elision.
  const orderMap = deriveOrders(canon.rules);
  const usedManifestPaths = new Set<string>();

  for (const rule of canon.rules) {
    const clone = structuredClone(rule) as ExportedRule;

    // 6. Rewrite schema refs (UUID → $schema:name); warn on UUIDs absent from schemas[].
    if (clone.pipelineConfig) {
      walkSchemaRefs(clone.pipelineConfig, (ref, set) => {
        const name = idToName.get(ref);
        if (name) set(`$schema:${name}`);
        else if (UUID_RE.test(ref)) warnings.push(`unresolved schema id ${ref} in rule ${clone.pathPattern}`);
      });
    }

    // 2. Directory segments / method stem / _custom fallback.
    const segments = patternToRelPath(clone.pathPattern);
    const isCustom = segments === null;
    const baseSegments = isCustom ? ['_custom', slugForPattern(clone.pathPattern)] : segments!;
    // A `methods:` list is only legal under an `any` stem, so it decides the stem — a rule
    // carrying both (legacy dual-field rules) would otherwise land in a `<method>` stem whose
    // manifest the compiler rejects. `methods[]` also wins at match time (backend
    // method-match.ts), so the redundant `method` this drops is not load-bearing.
    const stem = clone.methods?.length
      ? 'any'
      : clone.method
        ? clone.method.toLowerCase()
        : 'any';

    // 3. Directory shape iff any function_handler step exists.
    const allSteps: PipelineStep[] = clone.pipelineConfig
      ? [...clone.pipelineConfig.steps, ...(clone.pipelineConfig.postSteps ?? [])]
      : [];
    const hasFn = allSteps.some((s) => s.handlerType === 'function_handler');

    // Manifest path (+ 7. collision suffixing on the base's last segment).
    const buildPath = (base: string[]) => {
      const dseg = hasFn ? [...base, stem] : base;
      const ruleFile = hasFn ? 'rule.yaml' : `${stem}.rule.yaml`;
      return { rel: ['rules', ...dseg, ruleFile].join('/'), dirRel: ['rules', ...dseg].join('/') };
    };
    let base = baseSegments;
    let built = buildPath(base);
    let collided = false;
    if (usedManifestPaths.has(built.rel)) {
      collided = true;
      const lastIdx = baseSegments.length - 1;
      let n = 1;
      do {
        n++;
        base = [...baseSegments.slice(0, lastIdx), `${baseSegments[lastIdx]}-${n}`];
        built = buildPath(base);
      } while (usedManifestPaths.has(built.rel));
      warnings.push(`two rules map to the same path; ${clone.pathPattern} written under -${n} suffix`);
    }
    usedManifestPaths.add(built.rel);

    // Path/method are encoded in the layout; recompute default pipeline name from the base used.
    const pipelineDefaultName = defaultPipelineName(base, stem);

    // 5. Elide defaults, elide path/method (layout-encoded), elide derived `order:`.
    const manifest = elideRuleDefaults(clone) as Record<string, unknown>;
    delete manifest.method;
    // Keep an explicit pathPattern when the layout can't encode it: a `_custom` fallback, or a
    // suffixed directory whose derived pattern would no longer match the original.
    if (isCustom || collided) manifest.pathPattern = clone.pathPattern;
    else delete manifest.pathPattern;
    const derived = orderMap.get(rule);
    if (typeof manifest.order === 'number' && manifest.order === derived) delete manifest.order;

    // 4/5. pipelineConfig → pipeline sugar (extracts function_handler code to siblings).
    if (manifest.pipelineConfig) {
      manifest.pipeline = pipelineToSugar(
        manifest.pipelineConfig as PipelineConfig,
        pipelineDefaultName,
        built.dirRel,
        files,
      );
      delete manifest.pipelineConfig;
    }

    files.set(built.rel, toYaml(orderKeys(manifest, MANIFEST_KEY_ORDER)));
  }

  return { files, warnings };
}

export async function writeDecompiled(
  res: DecompileResult,
  outDir: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !opts?.force) {
    throw new Error(`refusing to write to non-empty directory: ${outDir} (pass force to overwrite)`);
  }
  for (const [rel, content] of res.files) {
    const full = path.join(outDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}
