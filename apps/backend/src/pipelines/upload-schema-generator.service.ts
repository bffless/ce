import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { db } from '../db/client';
import { pipelineSchemas, proxyRuleSets, proxyRules, NewPipelineSchema } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import {
  GenerateUploadSchemaDto,
  GenerateUploadSchemaResponseDto,
} from './dto/generate-upload-schema.dto';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';
import type { PipelineConfig, PipelineStepConfig } from '../db/schema/proxy-rules.schema';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import type { ValidatorConfig } from './types';
import { SchemaGeneratorRevisionsService } from './schema-generator-revisions.service';
import { UPLOAD_RECORD_FIELDS } from './upload-schema-contract';
import { eq, and } from 'drizzle-orm';

/**
 * Service for generating upload schemas with associated pipelines.
 * Creates a schema for file metadata plus POST (upload) and GET (serve) pipelines.
 */
@Injectable()
export class UploadSchemaGeneratorService {
  private readonly logger = new Logger(UploadSchemaGeneratorService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly revisions: SchemaGeneratorRevisionsService,
  ) {}

  /**
   * Generate an upload schema with POST (upload) and GET (serve) pipelines.
   *
   * Creates:
   * 1. A pipeline schema with upload metadata fields
   * 2. A rule set for the upload endpoints
   * 3. POST pipeline for uploading files (always requires auth)
   * 4. GET pipeline for serving files (access control configurable)
   */
  async generateUploadSchema(
    dto: GenerateUploadSchemaDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<GenerateUploadSchemaResponseDto> {
    await this.permissionsService.requireProjectAccess(
      dto.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Check for existing schema with same name
    const [existingSchema] = await db
      .select()
      .from(pipelineSchemas)
      .where(
        and(
          eq(pipelineSchemas.projectId, dto.projectId),
          eq(pipelineSchemas.name, dto.name),
        ),
      )
      .limit(1);

    if (existingSchema) {
      throw new ConflictException(`A schema with name "${dto.name}" already exists`);
    }

    // The record shape upload handlers write — shared with the writer so the
    // generated schema and the actual records cannot drift apart.
    const fields: SchemaField[] = UPLOAD_RECORD_FIELDS.map((f) => ({ ...f }));

    // Create the schema
    const [schema] = await db
      .insert(pipelineSchemas)
      .values({
        projectId: dto.projectId,
        name: dto.name,
        fields,
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created upload schema '${dto.name}' (${schema.id})`);

    // Use existing rule set or create a new one
    let ruleSet: ProxyRuleSet;

    if (dto.ruleSetId) {
      const [existingRuleSet] = await db
        .select()
        .from(proxyRuleSets)
        .where(
          and(
            eq(proxyRuleSets.id, dto.ruleSetId),
            eq(proxyRuleSets.projectId, dto.projectId),
          ),
        )
        .limit(1);

      if (!existingRuleSet) {
        throw new Error(
          `Rule set ${dto.ruleSetId} not found or does not belong to this project`,
        );
      }

      ruleSet = existingRuleSet;
      this.logger.log(`Using existing rule set '${ruleSet.name}' (${ruleSet.id})`);
    } else {
      const ruleSetName = `${dto.name}_pipelines`;
      const [newRuleSet] = await db
        .insert(proxyRuleSets)
        .values({
          projectId: dto.projectId,
          name: ruleSetName,
          description: `Auto-generated pipelines for ${dto.name} upload schema`,
        })
        .returning();

      ruleSet = newRuleSet;
      this.logger.log(`Created rule set '${ruleSet.name}' (${ruleSet.id})`);
    }

    // Backfill, pre-mutation: adding rules to an existing set is destructive
    // for revision-history purposes, so snapshot its pre-generate state if it
    // has none yet. No-ops for the set we just created (it has no rules).
    await this.revisions.backfill(ruleSet, userId);

    // Create POST and GET pipelines
    const pipelines: { id: string; path: string; method: string }[] = [];
    const uploadPath = `/api/uploads/${dto.subDir}`;
    const servePath = `/api/uploads/${dto.subDir}/*`;

    // POST pipeline (upload) - always requires auth
    const postConfig = this.createUploadPipelineConfig(dto, schema.id);
    const [postRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: uploadPath,
        method: 'POST',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: postConfig,
        order: 0,
        isEnabled: true,
        description: `Upload files to ${dto.name}`,
      })
      .returning();

    pipelines.push({
      id: postRule.id,
      path: uploadPath,
      method: 'POST',
    });

    // GET pipeline (serve) - access control configurable
    const getConfig = this.createServePipelineConfig(dto);
    const [getRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: servePath,
        method: 'GET',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: getConfig,
        order: 1,
        isEnabled: true,
        description: `Serve files from ${dto.name}`,
      })
      .returning();

    pipelines.push({
      id: getRule.id,
      path: servePath,
      method: 'GET',
    });

    this.logger.log(
      `Created ${pipelines.length} pipelines for upload schema '${dto.name}'`,
    );

    // Post-write, best-effort: capture the generated state so a later rollback
    // can't restore a revision that predates these rules and prune them away.
    await this.revisions.capture(ruleSet, dto.ruleSetId ? 'rule_edit' : 'create', userId);

    return {
      schema: {
        id: schema.id,
        name: schema.name,
        projectId: schema.projectId,
        fields: schema.fields.map((f) => ({
          name: f.name,
          type: f.type,
          required: f.required,
        })),
        createdAt: schema.createdAt.toISOString(),
        updatedAt: schema.updatedAt.toISOString(),
      },
      pipelines,
    };
  }

  /**
   * Create pipeline config for POST (upload) endpoint.
   * Always requires authentication.
   */
  private createUploadPipelineConfig(
    dto: GenerateUploadSchemaDto,
    schemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: File upload handler
    steps.push({
      id: 'upload',
      name: 'upload',
      handlerType: 'file_upload_handler',
      config: {
        schemaId,
        subDir: dto.subDir,
        dateBucket: dto.dateBucket ?? false,
        maxFileSize: dto.maxFileSize,
        allowedMimeTypes: dto.allowedMimeTypes,
      },
      isEnabled: true,
    });

    // Step 2: Response handler
    steps.push({
      id: 'response',
      name: 'Return Upload Result',
      handlerType: 'response_handler',
      config: {
        status: 200,
        body: '{{{steps.upload}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `Upload ${dto.name}`,
      description: `Upload files to ${dto.name}`,
      validators: [
        { type: 'auth_required', config: { allowApiKey: true } },
      ] as ValidatorConfig[],
      steps,
    };
  }

  /**
   * Create pipeline config for GET (serve) endpoint.
   * Access control based on dto.accessControl.
   */
  private createServePipelineConfig(dto: GenerateUploadSchemaDto): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: File serve handler
    steps.push({
      id: 'serve',
      name: 'serve',
      handlerType: 'file_serve_handler',
      config: {
        subDir: dto.subDir,
      },
      isEnabled: true,
    });

    // Build validators based on access control
    const validators: ValidatorConfig[] = [];
    const accessControl = dto.accessControl || 'public';

    if (accessControl === 'authenticated') {
      validators.push({ type: 'auth_required', config: {} });
    } else if (accessControl === 'role') {
      validators.push({
        type: 'auth_required',
        config: { roles: dto.requiredRole ? [dto.requiredRole] : [] },
      });
    }
    // 'public' = no validators

    return {
      name: `Serve ${dto.name}`,
      description: `Serve files from ${dto.name}`,
      validators,
      steps,
    };
  }

}
