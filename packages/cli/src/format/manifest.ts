import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Zod validation layer for the authoring YAML files (`ruleset.yaml`, `*.rule.yaml`,
 * `schemas/<name>.schema.yaml`, `*.fn.test.yaml`). All object schemas are STRICT
 * (`.strict()`) — unknown keys are rejected with their path in the error message. This
 * is the authoring-time typo guard: the manifest layer is where typos must die, before
 * they get silently dropped by the (permissive) canonical/compile layers.
 *
 * Free-form data bags that mirror a `Record<string, unknown>` in the wire-format types
 * (`headerConfig.add`, `authTransform`, `emailHandlerConfig`, step `config`, schema
 * `fields[]`) are intentionally left open (`z.record`/`.catchall`) rather than strict —
 * they hold arbitrary user/handler-defined data, not authoring keys we can typo-check.
 */

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const MethodSchema = z.enum(HTTP_METHODS);

const PROXY_TYPES = ['external_proxy', 'internal_rewrite', 'email_form_handler', 'pipeline'] as const;

const HeaderConfigSchema = z
  .object({
    forward: z.array(z.string()).optional(),
    strip: z.array(z.string()).optional(),
    add: z.record(z.string()).optional(),
  })
  .strict();

const PipelineValidatorSchema = z
  .object({
    type: z.enum(['auth_required', 'rate_limit']),
    config: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * Canonical pipeline step shape (matches `PipelineStep` in src/format/types.ts) — used for
 * `pipelineConfig:`. `name` is optional to match the server, which treats it as an optional
 * display label (`CreateProxyRuleDto`, `@IsOptional()`). Steps authored in the dashboard can
 * legitimately have none, and requiring it here would make `pull` emit manifests that
 * `validate`/`diff`/`push` then reject.
 */
const PipelineStepCanonicalSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    handlerType: z.string(),
    config: z.record(z.unknown()),
    isEnabled: z.boolean().optional(),
  })
  .strict();

/** Canonical pipeline config shape (matches `PipelineConfig` in src/format/types.ts) — used for `pipelineConfig:`. */
const PipelineConfigSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    steps: z.array(PipelineStepCanonicalSchema),
    postSteps: z.array(PipelineStepCanonicalSchema).optional(),
    validators: z.array(PipelineValidatorSchema).optional(),
  })
  .strict();

/**
 * Authoring pipeline step shape — used for `pipeline:`. Uses `handler:` instead of
 * `handlerType:`, and allows an optional `code:` (relative path ending `.js` or `.ts`) as a
 * convenience for supplying handler code out-of-line instead of inline in `config.code`. A
 * `.ts` ref is bundled (esbuild) at build time — see "TypeScript handlers" in reference.md;
 * a `.js` ref is inlined byte-verbatim as before. A step may not set both `code`/`config.code`.
 * `name` is optional, matching the server — see `PipelineStepCanonicalSchema` above.
 */
const PipelineStepManifestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    handler: z.string(),
    config: z.record(z.unknown()).optional(),
    code: z.string().regex(/\.(js|ts)$/, 'code must be a relative path ending in .js or .ts').optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const configHasCode =
      step.config !== undefined && typeof step.config === 'object' && step.config !== null && 'code' in step.config;
    if (step.code !== undefined && configHasCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'step may not set both `code` and `config.code`',
        path: ['code'],
      });
    }
  });

/**
 * Authoring pipeline config shape — used for `pipeline:`. `name` is optional here (the
 * compiler derives it from the rule/file, unlike the canonical `pipelineConfig.name`
 * which is required).
 */
const PipelineConfigManifestSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    steps: z.array(PipelineStepManifestSchema),
    postSteps: z.array(PipelineStepManifestSchema).optional(),
    validators: z.array(PipelineValidatorSchema).optional(),
  })
  .strict();

/** `ruleset.yaml` */
export const RulesetManifestSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    environment: z.string().optional(),
  })
  .strict();
export type RulesetManifest = z.infer<typeof RulesetManifestSchema>;

/**
 * `*.rule.yaml` / `rule.yaml`. Every `ExportedRule` key is optional (pathPattern/method
 * are normally derived from the filesystem location — `pathPattern:`/`methods:`/`method:`
 * are explicit escape hatches), plus the authoring-only `pipeline:` key. Exactly one of
 * `pipeline`/`pipelineConfig` may be present.
 */
export const RuleManifestSchema = z
  .object({
    pathPattern: z.string().regex(/^[/*]/, 'pathPattern must start with "/" or "*"').optional(),
    method: MethodSchema.optional(),
    methods: z.array(MethodSchema).optional(),
    targetUrl: z.string().optional(),
    stripPrefix: z.boolean().optional(),
    order: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1000).max(120000).optional(),
    preserveHost: z.boolean().optional(),
    forwardCookies: z.boolean().optional(),
    headerConfig: HeaderConfigSchema.optional(),
    authTransform: z.record(z.unknown()).optional(),
    internalRewrite: z.boolean().optional(),
    proxyType: z.enum(PROXY_TYPES).optional(),
    emailHandlerConfig: z.record(z.unknown()).optional(),
    pipelineConfig: PipelineConfigSchema.optional(),
    pipeline: PipelineConfigManifestSchema.optional(),
    isEnabled: z.boolean().optional(),
    debugEnabled: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine((rule) => !(rule.pipeline !== undefined && rule.pipelineConfig !== undefined), {
    message: '`pipeline` and `pipelineConfig` may not both be present',
  });
export type RuleManifest = z.infer<typeof RuleManifestSchema>;

const SchemaFieldSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
  })
  // SchemaField (src/format/types.ts) declares `[k: string]: unknown` — mirror that open
  // shape rather than `.strict()`; extra keys here are handler/UI-defined field metadata,
  // not authoring keys we want to typo-guard.
  .catchall(z.unknown());

/** `schemas/<name>.schema.yaml` */
export const SchemaManifestSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string(),
    // Declares what the schema is FOR. Adopted by `rules push` onto a live
    // schema that has none; a genuine conflict warns and the live value wins.
    kind: z.enum(['upload', 'chat', 'state']).optional(),
    fields: z.array(SchemaFieldSchema),
  })
  .strict();
export type SchemaManifest = z.infer<typeof SchemaManifestSchema>;

const FnTestCaseDataSchema = z
  .object({
    user: z.unknown().optional(),
    request: z.unknown().optional(),
    steps: z.unknown().optional(),
    deployment: z.unknown().optional(),
  })
  .strict();

const FnTestCaseExpectSchema = z
  .object({
    result: z.unknown().optional(),
    throws: z.string().optional(),
  })
  .strict()
  .refine((v) => v.result !== undefined || v.throws !== undefined, {
    message: 'expect must include at least one of `result` or `throws`',
  });

const FnTestCaseSchema = z
  .object({
    name: z.string(),
    data: FnTestCaseDataSchema.optional(),
    expect: FnTestCaseExpectSchema,
  })
  .strict();

/** `*.fn.test.yaml` */
export const FnTestManifestSchema = z
  .object({
    handler: z.string(),
    cases: z.array(FnTestCaseSchema),
  })
  .strict();
export type FnTestManifest = z.infer<typeof FnTestManifestSchema>;

/** Formats a zod issue path (mixed string/number segments) as `a.b[0].c`. */
function formatIssuePath(path: (string | number)[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out.length > 0 ? `.${segment}` : segment;
    }
  }
  return out;
}

/**
 * Reads `filePath`, parses it as YAML, and validates it against `schema`. On failure,
 * throws an `Error` whose message contains the file path and every zod issue's path +
 * message, e.g. `rules/api/x/get.rule.yaml: pipeline.steps[0].handler — Required`.
 */
export function parseYamlFile<T>(filePath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(filePath, 'utf8');

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new Error(`${filePath}: YAML parse error — ${(err as Error).message}`);
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const pathStr = formatIssuePath(issue.path);
        return pathStr.length > 0 ? `${pathStr} — ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new Error(`${filePath}: ${issues}`);
  }
  return result.data;
}
