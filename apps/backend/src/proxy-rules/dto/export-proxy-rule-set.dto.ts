import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuthTransformConfigDto,
  EmailHandlerConfigDto,
  HeaderConfigDto,
  PipelineConfigDto,
} from './create-proxy-rule.dto';
import { SchemaFieldDto } from '../../pipelines/dto/create-pipeline-schema.dto';

/**
 * Response DTOs for `GET /api/proxy-rule-sets/:id/export` — the canonical v2
 * export envelope. Swagger documentation for the shapes defined in
 * `../export-format.util.ts` (which is the runtime source of truth; the CLI's
 * `packages/cli/src/format/types.ts` is the cross-package ground truth).
 */

export class ExportedSchemaDto {
  @ApiProperty({ description: 'Schema id as referenced by the exported rules' })
  id: string;

  @ApiProperty({ description: 'Schema name' })
  name: string;

  @ApiProperty({ type: [SchemaFieldDto], description: 'Schema field definitions (no data rows)' })
  fields: SchemaFieldDto[];
}

/**
 * A single exported rule: portable config only — server-managed fields
 * (`id`, `ruleSetId`, timestamps) never appear, and `null` values are
 * stripped at the rule top level. Header `add` values are blanked to `''`
 * (secrets are never exported).
 */
export class ExportedProxyRuleDto {
  @ApiProperty({ description: 'Path pattern to match', example: '/api/*' })
  pathPattern: string;

  @ApiPropertyOptional({ description: 'HTTP method to match (absent = any)' })
  method?: string;

  @ApiPropertyOptional({
    description: 'HTTP methods to match (takes precedence over method when set)',
    isArray: true,
  })
  methods?: string[];

  @ApiProperty({ description: 'Target URL to forward requests to' })
  targetUrl: string;

  @ApiPropertyOptional({ description: 'Remove matched prefix from path' })
  stripPrefix?: boolean;

  @ApiPropertyOptional({ description: 'Rule evaluation order' })
  order?: number;

  @ApiPropertyOptional({ description: 'Request timeout in milliseconds' })
  timeout?: number;

  @ApiPropertyOptional({ description: 'Preserve original Host header' })
  preserveHost?: boolean;

  @ApiPropertyOptional({ description: 'Forward cookies to the target' })
  forwardCookies?: boolean;

  @ApiPropertyOptional({
    type: HeaderConfigDto,
    description: 'Header configuration; added-header values are blanked to empty strings',
  })
  headerConfig?: HeaderConfigDto;

  @ApiPropertyOptional({
    type: AuthTransformConfigDto,
    description: 'Auth transform configuration',
  })
  authTransform?: AuthTransformConfigDto;

  @ApiPropertyOptional({ description: 'Rewrite internally instead of proxying' })
  internalRewrite?: boolean;

  @ApiPropertyOptional({
    description: 'Rule type',
    enum: ['external_proxy', 'internal_rewrite', 'email_form_handler', 'pipeline'],
  })
  proxyType?: string;

  @ApiPropertyOptional({
    type: EmailHandlerConfigDto,
    description: 'Email form handler configuration',
  })
  emailHandlerConfig?: EmailHandlerConfigDto;

  @ApiPropertyOptional({ type: PipelineConfigDto, description: 'Pipeline configuration' })
  pipelineConfig?: PipelineConfigDto;

  @ApiPropertyOptional({ description: 'Whether this rule is active' })
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Whether debug logging is enabled' })
  debugEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Served despite the deployment visibility gate (only present when true)',
  })
  bypassVisibility?: boolean;

  @ApiPropertyOptional({ description: 'Optional description' })
  description?: string;
}

export class ExportedRuleSetMetaDto {
  @ApiProperty({ description: 'Rule set name' })
  name: string;

  @ApiPropertyOptional({ description: 'Rule set description' })
  description?: string;

  @ApiPropertyOptional({ description: 'Environment tag' })
  environment?: string;
}

export class ExportProxyRuleSetResponseDto {
  @ApiProperty({ description: 'Export format version', example: 2 })
  version: 2;

  @ApiProperty({ description: 'ISO timestamp the export was created' })
  exportedAt: string;

  @ApiProperty({ description: 'Export kind discriminator', example: 'bffless-proxy-rule-set' })
  kind: 'bffless-proxy-rule-set';

  @ApiProperty({ type: ExportedRuleSetMetaDto, description: 'Rule set metadata' })
  ruleSet: ExportedRuleSetMetaDto;

  @ApiProperty({ type: [ExportedProxyRuleDto], description: 'Exported rules in evaluation order' })
  rules: ExportedProxyRuleDto[];

  @ApiPropertyOptional({
    type: [ExportedSchemaDto],
    description:
      'Schema definitions the pipeline rules depend on (bundled for portability); omitted when none',
  })
  schemas?: ExportedSchemaDto[];
}
