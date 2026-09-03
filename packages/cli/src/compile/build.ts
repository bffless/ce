/**
 * Compiler: authoring layout (`ruleset.yaml` + `rules/` + `schemas/`) → a canonical
 * `RuleSetExport` (the wire format consumed by the DB import). See task-6 brief for the
 * binding 10-point behavior spec.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  RulesetManifestSchema,
  RuleManifestSchema,
  SchemaManifestSchema,
  parseYamlFile,
} from '../format/manifest.js';
import type { RuleManifest } from '../format/manifest.js';
import {
  relPathToPattern,
  deriveOrders,
  METHOD_STEMS,
  UUID_RE,
  defaultPipelineName,
  applyPathPrefix,
  assertPathPrefix,
} from '../format/routes.js';
import { applyRuleDefaults } from '../format/defaults.js';
import { canonicalizeExport } from '../format/canonical.js';
import { walkSchemaRefs } from '../format/schema-refs.js';
import { bundleHandler } from './bundle.js';
import type {
  RuleSetExport,
  ExportedRule,
  ExportedSchema,
  PipelineConfig,
  PipelineStep,
} from '../format/types.js';

export interface BuildResult {
  export: RuleSetExport;
  warnings: string[];
  secrets: string[];
  skillRefs: string[];
}

/** RFC-4122 namespace UUID for schema-id derivation. (Plan text carried a non-hex string
 *  `…-bffle55c0de0`; `l` is not a hex digit, so it can't be parsed as a UUID. Corrected to
 *  the valid `…-bff1e55c0de0` — see task-6 report.) */
export const SCHEMA_NAMESPACE = '6e1a24d0-0000-4000-8000-bff1e55c0de0';

const RULE_FILE_RE = new RegExp(`^(${[...METHOD_STEMS].join('|')})\\.rule\\.yaml$`);
const SECRET_RE = /\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

/** RFC-4122 v5 (SHA-1). ~15 lines, no dependency. */
export function uuidv5(name: string, namespace: string): string {
  const nsHex = namespace.replace(/-/g, '');
  const nsBytes = Buffer.from(nsHex, 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface Discovered {
  manifestPath: string; // the *.rule.yaml / rule.yaml file
  manifestDir: string; // directory files (code:, $file:) resolve relative to
  methodStem: string; // get|post|…|any
  stemFileDisplay: string; // display name of the stem file for error messages, e.g. `post.rule.yaml` or `post/rule.yaml`
  dirSegments: string[]; // path segments between rules/ and the method file/dir
}

/** Recursively find single-file (`get.rule.yaml`) and directory-shape (`post/rule.yaml`) rules.
 *  Directory entries are sorted by name so discovery order — and therefore duplicate-error
 *  file ordering — is deterministic across filesystems. */
function discoverRules(rulesDir: string, segments: string[], out: Discovered[]): void {
  if (!existsSync(rulesDir)) return;
  const entries = readdirSync(rulesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(rulesDir, entry.name);
    if (entry.isFile()) {
      const m = RULE_FILE_RE.exec(entry.name);
      if (m) {
        out.push({
          manifestPath: full,
          manifestDir: rulesDir,
          methodStem: m[1],
          stemFileDisplay: entry.name,
          dirSegments: segments,
        });
      }
      continue;
    }
    if (entry.isDirectory()) {
      const ruleYaml = path.join(full, 'rule.yaml');
      if (METHOD_STEMS.has(entry.name) && existsSync(ruleYaml)) {
        out.push({
          manifestPath: ruleYaml,
          manifestDir: full,
          methodStem: entry.name,
          stemFileDisplay: `${entry.name}/rule.yaml`,
          dirSegments: segments,
        });
      } else {
        discoverRules(full, [...segments, entry.name], out);
      }
    }
  }
}

/** Resolve `ref` relative to `manifestDir`, rejecting absolute refs and any resolution that
 *  escapes `setDir` (path traversal guard for `$file:`/`code:` refs). This is a lexical check
 *  only — it does not follow symlinks. Callers MUST also call `assertRealpathConfined` once
 *  the target's existence has been confirmed, to catch a symlink inside the rule set dir that
 *  points outside it. */
export function resolveConfinedPath(setDir: string, manifestDir: string, manifestPath: string, ref: string): string {
  if (path.isAbsolute(ref)) {
    throw new Error(`${manifestPath}: file reference escapes the rule set directory: ${ref}`);
  }
  const resolved = path.resolve(manifestDir, ref);
  const rel = path.relative(setDir, resolved);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`${manifestPath}: file reference escapes the rule set directory: ${ref}`);
  }
  return resolved;
}

/** After confirming `resolved` exists, verify its *realpath* (i.e. with symlinks followed) is
 *  still confined to `setDir`'s realpath. `resolveConfinedPath`'s check is purely lexical, so a
 *  symlink placed inside the rule set dir but pointing outside it would otherwise let `$file:`/
 *  `code:` refs inline arbitrary host files into compiled output. */
export function assertRealpathConfined(setDir: string, manifestPath: string, resolved: string, ref: string): void {
  const realSetDir = realpathSync(setDir);
  const realResolved = realpathSync(resolved);
  const rel = path.relative(realSetDir, realResolved);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`${manifestPath}: file reference escapes the rule set directory: ${ref}`);
  }
}

/** Deep-replace any `{ $file: <relpath> }` object with the referenced file's utf8 contents. */
function resolveFileRefs(value: unknown, setDir: string, manifestDir: string, manifestPath: string): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveFileRefs(v, setDir, manifestDir, manifestPath));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === '$file' && typeof obj.$file === 'string') {
      const file = resolveConfinedPath(setDir, manifestDir, manifestPath, obj.$file);
      if (!existsSync(file)) throw new Error(`${manifestPath}: $file not found: ${obj.$file}`);
      assertRealpathConfined(setDir, manifestPath, file, obj.$file);
      return readFileSync(file, 'utf8');
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = resolveFileRefs(obj[k], setDir, manifestDir, manifestPath);
    return out;
  }
  return value;
}

/** Convert authoring `pipeline:` sugar into a canonical `pipelineConfig`. Async because a
 *  `code:` ref ending `.ts` is bundled (esbuild, via `bundleHandler`) rather than raw-read —
 *  see "TypeScript handlers" in reference.md. `$file:` refs (handled separately by
 *  `resolveFileRefs`) are NOT bundled — TS bundling applies only to this `code:` sugar. */
async function compilePipeline(
  pipeline: NonNullable<RuleManifest['pipeline']>,
  defaultName: string,
  setDir: string,
  manifestDir: string,
  manifestPath: string,
  warnings: string[],
): Promise<PipelineConfig> {
  const convertSteps = async (steps: NonNullable<RuleManifest['pipeline']>['steps']): Promise<PipelineStep[]> => {
    const converted: PipelineStep[] = [];
    for (const step of steps) {
      const config: Record<string, unknown> = { ...(step.config ?? {}) };
      if (step.code !== undefined) {
        const file = resolveConfinedPath(setDir, manifestDir, manifestPath, step.code);
        if (!existsSync(file)) throw new Error(`${manifestPath}: code file not found: ${step.code}`);
        assertRealpathConfined(setDir, manifestPath, file, step.code);
        if (step.code.endsWith('.ts')) {
          const bundled = await bundleHandler(file, setDir);
          config.code = bundled.code;
          warnings.push(...bundled.warnings);
        } else {
          config.code = readFileSync(file, 'utf8');
        }
      }
      const out: PipelineStep = { handlerType: step.handler, config };
      if (step.name !== undefined) out.name = step.name;
      if (step.id !== undefined) out.id = step.id;
      if (step.isEnabled !== undefined) out.isEnabled = step.isEnabled;
      converted.push(out);
    }
    return converted;
  };

  const pc: PipelineConfig = { name: pipeline.name ?? defaultName, steps: await convertSteps(pipeline.steps) };
  if (pipeline.description !== undefined) pc.description = pipeline.description;
  if (pipeline.postSteps !== undefined) pc.postSteps = await convertSteps(pipeline.postSteps);
  if (pipeline.validators !== undefined) pc.validators = pipeline.validators;
  return pc;
}

/** Collect distinct `{{secrets.NAME}}` names from every string value under `value`. */
function collectSecrets(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(SECRET_RE)) into.add(m[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectSecrets(v, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectSecrets(v, into);
  }
}

/** ai_handler steps with `config.skills.mode === 'selected'` → collect enabled skill names. */
function collectSkillRefs(steps: PipelineStep[] | undefined, into: Set<string>): void {
  if (!steps) return;
  for (const step of steps) {
    if (step.handlerType !== 'ai_handler') continue;
    const skills = (step.config as Record<string, unknown>).skills as Record<string, unknown> | undefined;
    if (!skills || skills.mode !== 'selected') continue;
    const enabled = skills.enabled;
    if (Array.isArray(enabled)) for (const s of enabled) if (typeof s === 'string') into.add(s);
  }
}

interface Compiled {
  partial: Partial<ExportedRule> & { pathPattern: string };
  descriptor: { pathPattern: string; method?: string };
  explicitOrder?: number;
  manifestPath: string;
}

export async function buildRuleSet(
  setDir: string,
  opts?: { exportedAt?: string; pathPrefix?: string },
): Promise<BuildResult> {
  // Validate eagerly: applyPathPrefix only runs for rules with a *derived* pathPattern, so a
  // rule set whose every rule has an explicit `pathPattern:` would otherwise accept a garbage
  // --path-prefix silently (it's never applied). The inner applyPathPrefix call stays too —
  // this is belt-and-suspenders, not a replacement.
  if (opts?.pathPrefix !== undefined) assertPathPrefix(opts.pathPrefix);

  const rulesetPath = path.join(setDir, 'ruleset.yaml');
  if (!existsSync(rulesetPath)) throw new Error(`not a rule set (no ruleset.yaml): ${setDir}`);
  const ruleset = parseYamlFile(rulesetPath, RulesetManifestSchema);

  const warnings: string[] = [];
  const secrets = new Set<string>();
  const skillRefs = new Set<string>();
  const schemasByName = new Map<string, ExportedSchema>();

  const resolveSchema = (name: string, fromFile: string): ExportedSchema => {
    const cached = schemasByName.get(name);
    if (cached) return cached;
    const schemaPath = path.join(setDir, 'schemas', `${name}.schema.yaml`);
    if (!existsSync(schemaPath)) {
      throw new Error(`${fromFile}: schema ref "$schema:${name}" has no manifest (schemas/${name}.schema.yaml)`);
    }
    const manifest = parseYamlFile(schemaPath, SchemaManifestSchema);
    const entry: ExportedSchema = {
      id: manifest.id ?? uuidv5(name, SCHEMA_NAMESPACE),
      name: manifest.name,
      // Key order matches the server's export builder — see ExportedSchema.
      ...(manifest.kind ? { kind: manifest.kind } : {}),
      fields: manifest.fields,
    };
    schemasByName.set(name, entry);
    return entry;
  };

  const discovered: Discovered[] = [];
  discoverRules(path.join(setDir, 'rules'), [], discovered);

  const compiled: Compiled[] = [];
  for (const d of discovered) {
    const manifest = parseYamlFile(d.manifestPath, RuleManifestSchema);
    const isAny = d.methodStem === 'any';
    const stemMethod = isAny ? undefined : d.methodStem.toUpperCase();

    if (manifest.methods !== undefined && !isAny) {
      throw new Error(`${d.manifestPath}: 'methods:' is only allowed in an 'any' rule (found in ${d.stemFileDisplay})`);
    }

    // `method:` escape hatch: in an `any` rule it's a single-method override (may not be
    // combined with `methods:`); in a method-stem file it must match the stem — a match is
    // silently accepted (harmless redundancy), a mismatch is an error. MethodSchema (see
    // format/manifest.ts) is a zod enum of uppercase-only values, so `manifest.method` is
    // already uppercase here; no case normalization is needed.
    let method: string | undefined;
    if (isAny) {
      if (manifest.method !== undefined && manifest.methods !== undefined) {
        throw new Error(`${d.manifestPath}: 'method:' and 'methods:' may not both be set`);
      }
      method = manifest.method;
    } else {
      if (manifest.method !== undefined && manifest.method !== stemMethod) {
        throw new Error(
          `${d.manifestPath}: method: ${manifest.method} conflicts with file stem '${d.stemFileDisplay}' (expected ${stemMethod})`,
        );
      }
      method = stemMethod;
    }

    // Order/specificity is derived from this same, final (post-prefix) pathPattern — CE's
    // request matcher selects the first match by ascending `order` over the *exported*
    // patterns, so ranking must reflect what CE actually sees. A uniform --path-prefix adds
    // the same literal segments to every derived pattern's literalCount and shifts every
    // wildcard index by the same amount, so it provably cannot change the *relative* order
    // among derived rules — nothing authored is perturbed. What it CAN legitimately change is
    // a derived rule's rank against an explicit, never-prefixed `pathPattern:` escape hatch
    // (e.g. a catch-all `/api/hello/*` should rank after the specific prefixed routes it
    // shares a prefix with) — see docs/reference.md's "Path prefix" section.
    const pathPattern = manifest.pathPattern ?? applyPathPrefix(relPathToPattern(d.dirSegments), opts?.pathPrefix);
    const pipelineDefaultName = defaultPipelineName(d.dirSegments, d.methodStem);

    // headerConfig.add must carry empty-string placeholders only — never real secret values.
    if (manifest.headerConfig?.add) {
      for (const v of Object.values(manifest.headerConfig.add)) {
        if (typeof v === 'string' && v.length > 0) {
          throw new Error(`${d.manifestPath}: secret values must not be committed; use empty-string placeholders`);
        }
      }
    }

    const partial: Partial<ExportedRule> & { pathPattern: string } = { pathPattern };
    if (method !== undefined) partial.method = method;
    if (manifest.methods !== undefined) partial.methods = manifest.methods;
    if (manifest.targetUrl !== undefined) partial.targetUrl = manifest.targetUrl;
    if (manifest.stripPrefix !== undefined) partial.stripPrefix = manifest.stripPrefix;
    if (manifest.timeout !== undefined) partial.timeout = manifest.timeout;
    if (manifest.preserveHost !== undefined) partial.preserveHost = manifest.preserveHost;
    if (manifest.forwardCookies !== undefined) partial.forwardCookies = manifest.forwardCookies;
    if (manifest.headerConfig !== undefined) partial.headerConfig = manifest.headerConfig;
    if (manifest.authTransform !== undefined) {
      partial.authTransform = resolveFileRefs(manifest.authTransform, setDir, d.manifestDir, d.manifestPath) as Record<
        string,
        unknown
      >;
    }
    if (manifest.internalRewrite !== undefined) partial.internalRewrite = manifest.internalRewrite;
    if (manifest.proxyType !== undefined) partial.proxyType = manifest.proxyType;
    if (manifest.emailHandlerConfig !== undefined) {
      partial.emailHandlerConfig = resolveFileRefs(
        manifest.emailHandlerConfig,
        setDir,
        d.manifestDir,
        d.manifestPath,
      ) as Record<string, unknown>;
    }

    let pipelineConfig: PipelineConfig | undefined;
    if (manifest.pipeline !== undefined) {
      pipelineConfig = await compilePipeline(
        manifest.pipeline,
        pipelineDefaultName,
        setDir,
        d.manifestDir,
        d.manifestPath,
        warnings,
      );
    } else if (manifest.pipelineConfig !== undefined) {
      pipelineConfig = resolveFileRefs(manifest.pipelineConfig, setDir, d.manifestDir, d.manifestPath) as PipelineConfig;
    }
    if (pipelineConfig) {
      // $file: refs inside pipeline step configs (pipeline sugar path already handled `code:`).
      pipelineConfig = resolveFileRefs(pipelineConfig, setDir, d.manifestDir, d.manifestPath) as PipelineConfig;
      // The backend's PipelineValidatorDto declares `config` as @IsObject() WITHOUT @IsOptional
      // (apps/backend/src/proxy-rules/dto/create-proxy-rule.dto.ts), so a validator authored
      // without `config:` (allowed by the zod manifest schema) would 400 the entire sync on
      // push. Normalize an absent validator config to `{}` in the compiled output.
      if (pipelineConfig.validators !== undefined) {
        pipelineConfig.validators = pipelineConfig.validators.map((v) =>
          v.config === undefined ? { ...v, config: {} } : v,
        );
      }
      // Resolve $schema: refs (and warn on raw UUIDs) in place.
      walkSchemaRefs(pipelineConfig, (ref, set) => {
        if (ref.startsWith('$schema:')) {
          const name = ref.slice('$schema:'.length);
          set(resolveSchema(name, d.manifestPath).id);
        } else if (UUID_RE.test(ref)) {
          warnings.push(`unresolved schema id ${ref} in ${d.manifestPath}`);
        }
      });
      collectSkillRefs(pipelineConfig.steps, skillRefs);
      collectSkillRefs(pipelineConfig.postSteps, skillRefs);
      partial.pipelineConfig = pipelineConfig;
    }

    if (manifest.isEnabled !== undefined) partial.isEnabled = manifest.isEnabled;
    if (manifest.debugEnabled !== undefined) partial.debugEnabled = manifest.debugEnabled;
    if (manifest.bypassVisibility !== undefined) partial.bypassVisibility = manifest.bypassVisibility;
    if (manifest.description !== undefined) partial.description = manifest.description;

    collectSecrets(partial, secrets);

    compiled.push({
      partial,
      descriptor: { pathPattern, method },
      explicitOrder: manifest.order,
      manifestPath: d.manifestPath,
    });
  }

  // Duplicate (pathPattern, method) — mirrors the DB unique key. Keyed on the final exported
  // pathPattern (partial.pathPattern) so a --path-prefix collision (an explicit `pathPattern:`
  // rule landing on the same string as a prefixed derived one) is still caught.
  const seen = new Map<string, string>();
  for (const c of compiled) {
    const key = `${c.partial.pathPattern} ${c.descriptor.method ?? ''}`;
    const prior = seen.get(key);
    if (prior) {
      throw new Error(
        `duplicate rule (${c.partial.pathPattern} ${c.descriptor.method ?? 'ANY'}) defined in both ${prior} and ${c.manifestPath}`,
      );
    }
    seen.set(key, c.manifestPath);
  }

  // Order: explicit manifest order wins; otherwise the specificity-sort position.
  const orderMap = deriveOrders(compiled.map((c) => c.descriptor));
  const rules: ExportedRule[] = compiled.map((c) => {
    c.partial.order = c.explicitOrder ?? orderMap.get(c.descriptor) ?? 0;
    return applyRuleDefaults(c.partial);
  });

  // Warn when two rules land on the same numeric order (explicit vs derived collision) —
  // the DB tolerates it but it makes tiebreak behavior implicit and easy to get wrong.
  const orderGroups = new Map<number, string[]>();
  for (const c of compiled) {
    const order = c.partial.order as number;
    const list = orderGroups.get(order);
    if (list) list.push(c.manifestPath);
    else orderGroups.set(order, [c.manifestPath]);
  }
  for (const order of [...orderGroups.keys()].sort((a, b) => a - b)) {
    const paths = orderGroups.get(order)!;
    if (paths.length > 1) {
      warnings.push(`multiple rules share order ${order}: ${paths.join(', ')}`);
    }
  }

  const schemas = [...schemasByName.values()];
  const exportObj: RuleSetExport = {
    version: 2,
    exportedAt: opts?.exportedAt ?? new Date().toISOString(),
    kind: 'bffless-proxy-rule-set',
    ruleSet: ruleset,
    rules,
    ...(schemas.length > 0 ? { schemas } : {}),
  };

  return {
    export: canonicalizeExport(exportObj),
    warnings,
    secrets: [...secrets].sort(),
    skillRefs: [...skillRefs].sort(),
  };
}
