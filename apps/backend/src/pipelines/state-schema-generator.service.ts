import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { db } from '../db/client';
import { pipelineSchemas, proxyRuleSets, proxyRules, NewPipelineSchema } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { GenerateStateSchemaDto, GenerateStateSchemaResponseDto } from './dto';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';
import type { PipelineConfig, PipelineStepConfig } from '../db/schema/proxy-rules.schema';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import { SchemaGeneratorRevisionsService } from './schema-generator-revisions.service';
import { eq, and } from 'drizzle-orm';

/**
 * Service for generating state schemas with associated pipelines.
 * Used by @bffless/use-bff-state React hook.
 */
@Injectable()
export class StateSchemaGeneratorService {
  private readonly logger = new Logger(StateSchemaGeneratorService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly revisions: SchemaGeneratorRevisionsService,
  ) {}

  /**
   * Generate a state schema with GET and POST pipelines.
   *
   * Creates:
   * 1. A pipeline schema with fields: key, value, user_id, guest_id, version
   * 2. A rule set for the state endpoints
   * 3. GET pipeline for retrieving state
   * 4. POST pipeline for updating state
   */
  async generateStateSchema(
    dto: GenerateStateSchemaDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<GenerateStateSchemaResponseDto> {
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

    // Define schema fields based on scope
    const fields: SchemaField[] = this.getSchemaFields(dto.scope);

    // Create the schema
    const [schema] = await db
      .insert(pipelineSchemas)
      .values({
        projectId: dto.projectId,
        name: dto.name,
        fields,
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created state schema '${dto.name}' (${schema.id})`);

    // Use existing rule set or create a new one
    let ruleSet: ProxyRuleSet;

    if (dto.ruleSetId) {
      // Verify the rule set exists and belongs to this project
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
        throw new Error(`Rule set ${dto.ruleSetId} not found or does not belong to this project`);
      }

      ruleSet = existingRuleSet;
      this.logger.log(`Using existing rule set '${ruleSet.name}' (${ruleSet.id})`);
    } else {
      // Create new rule set for state pipelines
      const ruleSetName = `${dto.name}_pipelines`;
      const [newRuleSet] = await db
        .insert(proxyRuleSets)
        .values({
          projectId: dto.projectId,
          name: ruleSetName,
          description: `Auto-generated pipelines for ${dto.name} state schema`,
        })
        .returning();

      ruleSet = newRuleSet;
      this.logger.log(`Created rule set '${ruleSet.name}' (${ruleSet.id})`);
    }

    // Backfill, pre-mutation: adding rules to an existing set is destructive
    // for revision-history purposes, so snapshot its pre-generate state if it
    // has none yet. No-ops for the set we just created (it has no rules).
    await this.revisions.backfill(ruleSet, userId);

    // Create GET and POST pipelines
    const pipelines: { id: string; path: string; method: string }[] = [];
    const apiPath = `/api/state/${dto.name}`;

    // GET pipeline
    const getConfig = this.createGetPipelineConfig(dto.name, dto.scope, schema.id);
    const [getRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: apiPath,
        method: 'GET',
        targetUrl: 'http://internal/pipeline', // Not used for pipelines
        proxyType: 'pipeline',
        pipelineConfig: getConfig,
        order: 0,
        isEnabled: true,
        description: `GET state for ${dto.name}`,
      })
      .returning();

    pipelines.push({
      id: getRule.id,
      path: apiPath,
      method: 'GET',
    });

    // POST pipeline
    const postConfig = this.createPostPipelineConfig(dto.name, dto.scope, schema.id);
    const [postRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: apiPath,
        method: 'POST',
        targetUrl: 'http://internal/pipeline', // Not used for pipelines
        proxyType: 'pipeline',
        pipelineConfig: postConfig,
        order: 1,
        isEnabled: true,
        description: `POST/update state for ${dto.name}`,
      })
      .returning();

    pipelines.push({
      id: postRule.id,
      path: apiPath,
      method: 'POST',
    });

    this.logger.log(`Created ${pipelines.length} pipelines for state schema '${dto.name}'`);

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
   * Get schema fields based on scope
   */
  private getSchemaFields(scope: 'global' | 'user'): SchemaField[] {
    const baseFields: SchemaField[] = [
      { name: 'key', type: 'string', required: true },
      { name: 'value', type: 'json', required: true },
      { name: 'version', type: 'number', required: true, default: 1 },
    ];

    if (scope === 'user') {
      return [
        ...baseFields,
        { name: 'user_id', type: 'string', required: false },
        { name: 'guest_id', type: 'string', required: false },
      ];
    }

    return baseFields;
  }

  /**
   * Create pipeline config for GET endpoint
   */
  private createGetPipelineConfig(
    name: string,
    scope: 'global' | 'user',
    schemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Data Query - find existing record
    if (scope === 'user') {
      // User-scoped: match by user_id OR guest_id
      steps.push({
        id: 'query',
        name: 'query',
        handlerType: 'data_query',
        config: {
          schemaId,
          single: true,
          filters: {
            user_id: { op: 'eq', value: 'user.id' },
            guest_id: { op: 'eq', value: 'request.query._bffGuestId' },
          },
          filterLogic: 'or',
        },
        isEnabled: true,
      });
    } else {
      // Global: match by key only
      steps.push({
        id: 'query',
        name: 'query',
        handlerType: 'data_query',
        config: {
          schemaId,
          single: true,
          filters: {
            key: { op: 'eq', value: name },
          },
        },
        isEnabled: true,
      });
    }

    // Step 2: Function handler to extract value or return empty object
    steps.push({
      id: 'fallback',
      name: 'fallback',
      handlerType: 'function_handler',
      config: {
        code: `/**
 * Extract value from query result or return empty object.
 */
function handler({ user, request, steps }) {
  const { value } = steps.query || {};

  if (!value) {
    return {};
  }

  return {
    ...value
  };
}`,
      },
      isEnabled: true,
    });

    // Step 3: Response - return the value
    steps.push({
      id: 'response',
      name: 'Return State',
      handlerType: 'response_handler',
      config: {
        status: 200,
        body: '{{{steps.fallback}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `GET ${name}`,
      description: `Retrieve state for ${name}`,
      steps,
    };
  }

  /**
   * Create pipeline config for POST endpoint
   *
   * Uses conditional steps to implement upsert:
   * 1. Query for existing record (find)
   * 2. Create if not exists (condition: !steps.find)
   * 3. Update if exists (condition: steps.find)
   * 4. Format response
   * 5. Return response
   */
  private createPostPipelineConfig(
    name: string,
    scope: 'global' | 'user',
    schemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Query for existing record
    if (scope === 'user') {
      // User-scoped: match by user_id OR guest_id
      steps.push({
        id: 'find',
        name: 'find',
        handlerType: 'data_query',
        config: {
          schemaId,
          single: true,
          filters: {
            user_id: { op: 'eq', value: 'user.id' },
            guest_id: { op: 'eq', value: 'request.query._bffGuestId' },
          },
          filterLogic: 'or',
        },
        isEnabled: true,
      });
    } else {
      // Global: match by key only
      steps.push({
        id: 'find',
        name: 'find',
        handlerType: 'data_query',
        config: {
          schemaId,
          single: true,
          filters: {
            key: { op: 'eq', value: name },
          },
        },
        isEnabled: true,
      });
    }

    // Step 2: Create if not exists (condition: !steps.find)
    if (scope === 'user') {
      steps.push({
        id: 'create',
        name: 'create',
        handlerType: 'data_create',
        config: {
          schemaId,
          fields: {
            key: name,
            value: 'request.body',
            user_id: 'user.id',
            guest_id: 'request.query._bffGuestId',
            version: '0',
          },
          condition: '!steps.find',
        },
        isEnabled: true,
      });
    } else {
      steps.push({
        id: 'create',
        name: 'create',
        handlerType: 'data_create',
        config: {
          schemaId,
          fields: {
            key: name,
            value: 'request.body',
            version: '0',
          },
          condition: '!steps.find',
        },
        isEnabled: true,
      });
    }

    // Step 3: Update if exists (condition: steps.find)
    if (scope === 'user') {
      steps.push({
        id: 'update',
        name: 'update',
        handlerType: 'data_update',
        config: {
          schemaId,
          filters: {
            user_id: { op: 'eq', value: 'user.id' },
            guest_id: { op: 'eq', value: 'request.query._bffGuestId' },
          },
          filterLogic: 'or',
          fields: {
            value: 'request.body',
          },
          condition: 'steps.find',
        },
        isEnabled: true,
      });
    } else {
      steps.push({
        id: 'update',
        name: 'update',
        handlerType: 'data_update',
        config: {
          schemaId,
          filters: {
            key: { op: 'eq', value: name },
          },
          fields: {
            value: 'request.body',
          },
          condition: 'steps.find',
        },
        isEnabled: true,
      });
    }

    // Step 4: Function handler to format response
    steps.push({
      id: 'formatResponse',
      name: 'formatResponse',
      handlerType: 'function_handler',
      config: {
        code: `/**
 * Extract value from create or update result.
 */
function handler({ user, request, steps }) {
  const { value = {} } = steps.create || steps.update || {};

  return {
    ...value
  };
}`,
      },
      isEnabled: true,
    });

    // Step 5: Response - return the saved value
    steps.push({
      id: 'response',
      name: 'Return State',
      handlerType: 'response_handler',
      config: {
        status: 200,
        body: '{{{steps.formatResponse}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `POST ${name}`,
      description: `Save state for ${name}`,
      steps,
    };
  }

}
