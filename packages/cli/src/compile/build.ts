/**
 * Compiler: authoring layout (`ruleset.yaml` + `rules/` + `schemas/`) → a canonical
 * `RuleSetExport` (the wire format consumed by the DB import). See task-6 brief for the
 * binding 10-point behavior spec.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  RulesetManifestSchema,
  RuleManifestSchema,
  SchemaManifestSchema,
  parseYamlFile,
} from '../format/manifest.js';
import type { RuleManifest } from '../format/manifest.js';
import { relPathToPattern, deriveOrders } from '../format/routes.js';
import { applyRuleDefaults } from '../format/defaults.js';
import { canonicalizeExport } from '../format/canonical.js';
import { walkSchemaRefs } from '../format/schema-refs.js';
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

const METHOD_STEMS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'any'] as const;
const METHOD_STEM_SET = new Set<string>(METHOD_STEMS);
const RULE_FILE_RE = /^(get|post|put|patch|delete|head|options|any)\.rule\.yaml$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
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
  dirSegments: string[]; // path segments between rules/ and the method file/dir
}

/** Recursively find single-file (`get.rule.yaml`) and directory-shape (`post/rule.yaml`) rules. */
function discoverRules(rulesDir: string, segments: string[], out: Discovered[]): void {
  if (!existsSync(rulesDir)) return;
  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    const full = path.join(rulesDir, entry.name);
    if (entry.isFile()) {
      const m = RULE_FILE_RE.exec(entry.name);
      if (m) {
        out.push({ manifestPath: full, manifestDir: rulesDir, methodStem: m[1], dirSegments: segments });
      }
      continue;
    }
    if (entry.isDirectory()) {
      const ruleYaml = path.join(full, 'rule.yaml');
      if (METHOD_STEM_SET.has(entry.name) && existsSync(ruleYaml)) {
        out.push({ manifestPath: ruleYaml, manifestDir: full, methodStem: entry.name, dirSegments: segments });
      } else {
        discoverRules(full, [...segments, entry.name], out);
      }
    }
  }
}

/** Deep-replace any `{ $file: <relpath> }` object with the referenced file's utf8 contents. */
function resolveFileRefs(value: unknown, manifestDir: string, manifestPath: string): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveFileRefs(v, manifestDir, manifestPath));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === '$file' && typeof obj.$file === 'string') {
      const file = path.resolve(manifestDir, obj.$file);
      if (!existsSync(file)) throw new Error(`${manifestPath}: $file not found: ${obj.$file}`);
      return readFileSync(file, 'utf8');
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = resolveFileRefs(obj[k], manifestDir, manifestPath);
    return out;
  }
  return value;
}

/** Convert authoring `pipeline:` sugar into a canonical `pipelineConfig`. */
function compilePipeline(
  pipeline: NonNullable<RuleManifest['pipeline']>,
  defaultName: string,
  manifestDir: string,
  manifestPath: string,
): PipelineConfig {
  const convertSteps = (steps: NonNullable<RuleManifest['pipeline']>['steps']): PipelineStep[] =>
    steps.map((step) => {
      const config: Record<string, unknown> = { ...(step.config ?? {}) };
      if (step.code !== undefined) {
        const file = path.resolve(manifestDir, step.code);
        if (!existsSync(file)) throw new Error(`${manifestPath}: code file not found: ${step.code}`);
        config.code = readFileSync(file, 'utf8');
      }
      const out: PipelineStep = { name: step.name, handlerType: step.handler, config };
      if (step.id !== undefined) out.id = step.id;
      if (step.isEnabled !== undefined) out.isEnabled = step.isEnabled;
      return out;
    });

  const pc: PipelineConfig = { name: pipeline.name ?? defaultName, steps: convertSteps(pipeline.steps) };
  if (pipeline.description !== undefined) pc.description = pipeline.description;
  if (pipeline.postSteps !== undefined) pc.postSteps = convertSteps(pipeline.postSteps);
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

export async function buildRuleSet(setDir: string, opts?: { exportedAt?: string }): Promise<BuildResult> {
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
    const method = d.methodStem === 'any' ? undefined : d.methodStem.toUpperCase();

    if (manifest.methods !== undefined && d.methodStem !== 'any') {
      throw new Error(`${d.manifestPath}: 'methods:' is only allowed in an 'any' rule (found in ${d.methodStem}.rule.yaml)`);
    }

    const pathPattern = manifest.pathPattern ?? relPathToPattern(d.dirSegments);
    const routePath = d.dirSegments.join('/');
    const defaultPipelineName = `${routePath} ${d.methodStem.toUpperCase()}`;

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
      partial.authTransform = resolveFileRefs(manifest.authTransform, d.manifestDir, d.manifestPath) as Record<
        string,
        unknown
      >;
    }
    if (manifest.internalRewrite !== undefined) partial.internalRewrite = manifest.internalRewrite;
    if (manifest.proxyType !== undefined) partial.proxyType = manifest.proxyType;
    if (manifest.emailHandlerConfig !== undefined) {
      partial.emailHandlerConfig = resolveFileRefs(
        manifest.emailHandlerConfig,
        d.manifestDir,
        d.manifestPath,
      ) as Record<string, unknown>;
    }

    let pipelineConfig: PipelineConfig | undefined;
    if (manifest.pipeline !== undefined) {
      pipelineConfig = compilePipeline(manifest.pipeline, defaultPipelineName, d.manifestDir, d.manifestPath);
    } else if (manifest.pipelineConfig !== undefined) {
      pipelineConfig = resolveFileRefs(manifest.pipelineConfig, d.manifestDir, d.manifestPath) as PipelineConfig;
    }
    if (pipelineConfig) {
      // $file: refs inside pipeline step configs (pipeline sugar path already handled `code:`).
      pipelineConfig = resolveFileRefs(pipelineConfig, d.manifestDir, d.manifestPath) as PipelineConfig;
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
    if (manifest.description !== undefined) partial.description = manifest.description;

    collectSecrets(partial, secrets);

    compiled.push({
      partial,
      descriptor: { pathPattern, method },
      explicitOrder: manifest.order,
      manifestPath: d.manifestPath,
    });
  }

  // Duplicate (pathPattern, method) — mirrors the DB unique key.
  const seen = new Map<string, string>();
  for (const c of compiled) {
    const key = `${c.descriptor.pathPattern} ${c.descriptor.method ?? ''}`;
    const prior = seen.get(key);
    if (prior) {
      throw new Error(
        `duplicate rule (${c.descriptor.pathPattern} ${c.descriptor.method ?? 'ANY'}) defined in both ${prior} and ${c.manifestPath}`,
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
