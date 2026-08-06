import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateProxyRuleDto, IsValidTargetUrlOrPath } from './create-proxy-rule.dto';
import { CreateProxyRuleSetDto } from './proxy-rule-set.dto';
import { SchemaFieldDto } from '../../pipelines/dto/create-pipeline-schema.dto';
import type { ProxyType } from '../../db/schema/proxy-rules.schema';
import type { SchemaKind } from '../../db/schema/pipeline-schemas.schema';

/**
 * DTOs for the idempotent sync endpoint
 * (`PUT /api/proxy-rule-sets/project/:projectId/sync`) — Task 7 of the
 * proxy-rules-as-code Phase 1 plan
 * (`docs/plans/proxy-rules-as-code-phase1-implementation.md`).
 */

/**
 * Target-URL validator for sync payloads. Wraps {@link IsValidTargetUrlOrPath}
 * (closing the SSRF gap the plan doc calls out — import's laxness is
 * pre-existing and out of scope) with one sync-specific adjustment:
 * **CLI-parity proxyType inference**. Canonical payloads elide an inferable
 * `proxyType` (the CLI decompiler strips it when `pipelineConfig` /
 * `emailHandlerConfig` presence implies it), so the base validator's
 * pipeline/email exemptions must fire on the INFERRED type too — mirroring
 * `inferProxyType` in `sync-plan.util.ts`. Without this, an explicit
 * `targetUrl: "http://internal/pipeline"` on an elided pipeline rule would be
 * rejected as a non-internal HTTP URL even though the rule never proxies to it.
 *
 * An ABSENT `targetUrl` is handled by `@IsOptional` on the property (validators
 * are skipped entirely), so elided pipeline rules that omit `targetUrl` pass
 * without touching this class; normalization fills `http://internal/pipeline`
 * later (see `normalizeRule` in `sync-plan.util.ts`).
 */
@ValidatorConstraint({ name: 'isValidSyncTargetUrl', async: false })
export class IsValidSyncTargetUrl extends IsValidTargetUrlOrPath {
  validate(value: string, args: ValidationArguments): boolean {
    const obj = args.object as {
      proxyType?: ProxyType;
      pipelineConfig?: unknown;
      emailHandlerConfig?: unknown;
    };
    // Inferred pipeline / email_form_handler: targetUrl is unused for these
    // types, exactly like the base validator's explicit-proxyType exemptions.
    if (!obj.proxyType && (obj.pipelineConfig || obj.emailHandlerConfig)) {
      return true;
    }
    return super.validate(value, args);
  }
}

/**
 * One rule in a sync payload. Mirrors the import rule DTO
 * (`CreateProxyRuleInSetDto`) field-for-field — including the `method` /
 * `methods` `@IsIn` HTTP-method whitelists, which also protect the
 * `(pathPattern, method)` match key — except `targetUrl`, which is:
 *
 * - **optional** — elided canonical payloads omit it on pipeline rules
 *   (defaults-normalization fills `http://internal/pipeline` later), and
 * - validated by {@link IsValidSyncTargetUrl} when present (SSRF gap closure:
 *   HTTPS anywhere, HTTP only for `*.svc` / localhost, path-only for internal
 *   rewrites; pipeline/email rules — explicit or inferred — are exempt).
 */
export class SyncProxyRuleDto extends OmitType(CreateProxyRuleDto, [
  'ruleSetId',
  'targetUrl',
] as const) {
  @ApiPropertyOptional({
    description:
      'Target URL to forward requests to. Must be HTTPS, or HTTP for internal K8s services ' +
      '(*.svc, localhost); a path starting with "/" for internal rewrites. Optional: omitted ' +
      'on pipeline rules in canonical payloads (defaults to http://internal/pipeline).',
    example: 'https://api.example.com',
  })
  @IsOptional()
  @Validate(IsValidSyncTargetUrl)
  targetUrl?: string;
}

/**
 * A bundled schema definition in a sync payload — same shape as the export
 * envelope's `schemas[]` entries. Resolved by NAME against the target project
 * (non-interactive, unlike import's `ImportSchemaResolutionDto`).
 */
export class SyncSchemaDto {
  @ApiProperty({ description: 'Source schema id as referenced by the payload rules' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Schema name (the identity in the target project)' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    enum: ['upload', 'chat', 'state'],
    description:
      'Declared purpose of the schema. Adopted onto a live schema that has none; a genuine ' +
      'conflict warns and leaves the live value alone.',
  })
  @IsOptional()
  @IsIn(['upload', 'chat', 'state'])
  kind?: SchemaKind;

  @ApiProperty({ type: [SchemaFieldDto], description: 'Schema field definitions' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaFieldDto)
  fields: SchemaFieldDto[];
}

export class SyncOptionsDto {
  @ApiPropertyOptional({
    description: 'Delete live rules absent from the payload (default: report them as pruneCandidates)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  prune?: boolean;

  @ApiPropertyOptional({
    description: 'Compute and return the full change plan without writing anything',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Fail with 400 when a name-reused schema has mismatched field definitions (default: warn)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  strictSchemas?: boolean;

  @ApiPropertyOptional({
    description:
      'Resolve rules edited locally since this set was last synced by comparing against the most recent sync revision. ' +
      "'overwrite' (default) keeps two-way behaviour — the payload always wins, which is what rules-as-code CI wants. " +
      "'preserve' keeps the local edit and reports it, for app upgrades over a customized install.",
    enum: ['overwrite', 'preserve'],
    default: 'overwrite',
  })
  @IsOptional()
  @IsIn(['overwrite', 'preserve'])
  conflictPolicy?: 'overwrite' | 'preserve';
}

/**
 * Caller-supplied provenance, stamped onto the rule set's `source` column
 * together with the server-computed `syncedAt` / `contentHash`.
 */
export class SyncSourceDto {
  @ApiPropertyOptional({ description: 'Source repository', example: 'bffless/apps' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  repo?: string;

  @ApiPropertyOptional({
    description: 'Rule-set directory path within the repo',
    example: 'apps/studio/.bffless/proxy-rules/studio',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  path?: string;

  @ApiPropertyOptional({ description: 'Commit SHA the payload was built from' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  gitSha?: string;
}

/**
 * Request body for the idempotent sync endpoint. `ruleSet.name` is the set's
 * identity within the project (trimmed server-side, import parity); rules match
 * live rows on `(pathPattern, method ?? null)`.
 *
 * `version` / `exportedAt` / `kind` are accepted but ignored (import parity —
 * a raw export envelope plus options can be PUT without stripping; the global
 * ValidationPipe runs with `forbidNonWhitelisted`).
 */
export class SyncProxyRuleSetDto {
  @ApiPropertyOptional({ description: 'Export format version (ignored)', example: 2 })
  @IsOptional()
  @IsInt()
  version?: number;

  @ApiPropertyOptional({ description: 'ISO timestamp the payload was built (ignored)' })
  @IsOptional()
  @IsString()
  exportedAt?: string;

  @ApiPropertyOptional({ description: 'Export kind discriminator (ignored)' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiProperty({ type: CreateProxyRuleSetDto, description: 'Rule set metadata; name is the identity' })
  @ValidateNested()
  @Type(() => CreateProxyRuleSetDto)
  ruleSet: CreateProxyRuleSetDto;

  @ApiProperty({ type: [SyncProxyRuleDto], description: 'The desired rules (full declarative state)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncProxyRuleDto)
  rules: SyncProxyRuleDto[];

  @ApiPropertyOptional({
    type: [SyncSchemaDto],
    description: 'Schema definitions the pipeline rules depend on, resolved by name',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSchemaDto)
  schemas?: SyncSchemaDto[];

  @ApiPropertyOptional({ type: SyncOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SyncOptionsDto)
  options?: SyncOptionsDto;

  @ApiPropertyOptional({ type: SyncSourceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SyncSourceDto)
  source?: SyncSourceDto;
}

/** A `(pathPattern, method)` rule reference in the sync response. */
export class SyncRuleRefDto {
  @ApiProperty({ description: 'Path pattern of the rule', example: '/api/*' })
  pathPattern: string;

  @ApiProperty({
    description: 'HTTP method of the rule (null = any method)',
    nullable: true,
    example: 'GET',
  })
  method: string | null;
}

/** A conflicted rule plus the dotted paths of the fields both sides changed. */
export class SyncRuleConflictDto extends SyncRuleRefDto {
  @ApiProperty({
    type: [String],
    description: 'Dotted paths of the contested fields',
    example: ['pipelineConfig.steps.draft.config.skills.enabled'],
  })
  fields: string[];
}

/** One entry of `schemaResolutions[]` — see `SchemaResolution` in schema-sync.util. */
export class SyncSchemaResolutionDto {
  @ApiProperty({ description: 'Schema name' })
  name: string;

  @ApiProperty({ enum: ['reuse', 'create'], description: 'How the schema was resolved' })
  action: 'reuse' | 'create';

  @ApiProperty({
    nullable: true,
    description: 'Resolved schema id in the target project (null for a dryRun create)',
  })
  targetSchemaId: string | null;

  @ApiProperty({ description: 'Whether the reused schema has mismatched field definitions' })
  fieldMismatch: boolean;

  @ApiProperty({
    description:
      'Whether the payload\'s declared kind was written onto a live schema that had none ' +
      '(true under dryRun means it would be). Adoption only ever fills a null — a declared ' +
      'kind is never rewritten.',
  })
  kindAdopted: boolean;
}

/**
 * Sync response — also the dryRun plan. Shape pinned by the Phase 1 plan doc
 * (cross-cutting definitions). Arrays are deterministically ordered (sorted by
 * pathPattern then method) so CI output is byte-stable.
 */
export class SyncProxyRuleSetResponseDto {
  @ApiProperty({
    nullable: true,
    description: 'The synced rule set id (null on a dryRun of a set that does not exist yet)',
  })
  ruleSetId: string | null;

  @ApiProperty({ type: [SyncRuleRefDto], description: 'Rules created (or planned under dryRun)' })
  created: SyncRuleRefDto[];

  @ApiProperty({ type: [SyncRuleRefDto], description: 'Rules updated (or planned under dryRun)' })
  updated: SyncRuleRefDto[];

  @ApiProperty({
    type: [SyncRuleRefDto],
    description: 'Live-only rules deleted; only non-empty when options.prune',
  })
  deleted: SyncRuleRefDto[];

  @ApiProperty({ type: [SyncRuleRefDto], description: 'Rules that matched their live form exactly' })
  unchanged: SyncRuleRefDto[];

  @ApiProperty({
    type: [SyncRuleRefDto],
    description: 'Live-only rules NOT deleted because options.prune is false',
  })
  pruneCandidates: SyncRuleRefDto[];

  @ApiProperty({
    type: [SyncRuleRefDto],
    description:
      'Rules kept as-is because they were edited locally and the payload did not change them. ' +
      'Only non-empty under conflictPolicy=preserve.',
  })
  preserved: SyncRuleRefDto[];

  @ApiProperty({
    type: [SyncRuleConflictDto],
    description:
      'Rules with at least one field both sides changed differently since the last sync. Everything outside ' +
      '`fields` was merged automatically; conflictPolicy decided those. Reported under either policy.',
  })
  conflicts: SyncRuleConflictDto[];

  @ApiProperty({ type: [SyncSchemaResolutionDto], description: 'How each bundled schema was resolved' })
  schemaResolutions: SyncSchemaResolutionDto[];

  @ApiProperty({
    type: [String],
    description:
      'Referenced {{secrets.NAME}} names with no project secret, plus blank header-add names ' +
      'on new rules (nothing live to preserve). Warning-level — never fails the sync.',
  })
  missingSecrets: string[];

  @ApiProperty({ type: [String], description: 'Non-fatal warnings (schema mismatches, nginx failures)' })
  warnings: string[];

  @ApiProperty({ description: 'Whether this was a dry run (nothing was written)' })
  dryRun: boolean;

  @ApiProperty({ description: 'Whether the rule set was created (or would be, under dryRun)' })
  setCreated: boolean;
}
