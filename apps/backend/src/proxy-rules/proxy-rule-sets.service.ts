import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { proxyRuleSets, proxyRules, projects, aliasProxyRuleSets, deploymentAliases } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import {
  CreateProxyRuleSetDto,
  UpdateProxyRuleSetDto,
  ProxyRuleSetResponseDto,
  ProxyRuleSetWithRulesResponseDto,
  ImportProxyRuleSetDto,
} from './dto';
import type { PipelineConfig, ProxyType } from '../db/schema/proxy-rules.schema';
import { ProxyRulesService } from './proxy-rules.service';
import { collectSchemaIds, remapSchemaIds } from './schema-refs.util';
import {
  compareSchemaFields,
  type ComparableSchemaField,
  type SchemaResolution,
} from './schema-sync.util';
import {
  buildExportEnvelope,
  serializeRuleForExport,
  type ExportedSchema,
  type RuleSetExport,
} from './export-format.util';

@Injectable()
export class ProxyRuleSetsService {
  private readonly logger = new Logger(ProxyRuleSetsService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly proxyRulesService: ProxyRulesService,
    @Inject(forwardRef(() => NginxRegenerationService))
    private readonly nginxRegenerationService: NginxRegenerationService,
    @Inject(forwardRef(() => PipelineSchemasService))
    private readonly pipelineSchemasService: PipelineSchemasService,
  ) {}

  /**
   * List all rule sets for a project
   */
  async listByProject(
    projectId: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetResponseDto[]> {
    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, projectId);
    const ruleSets = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.projectId, projectId));

    return ruleSets;
  }

  /**
   * Get a rule set by ID with its rules
   */
  async getById(
    id: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetWithRulesResponseDto | null> {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, id))
      .limit(1);

    if (!ruleSet) return null;

    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, ruleSet.projectId);

    const rules = await this.proxyRulesService.getRulesByRuleSetId(id);

    return {
      ...ruleSet,
      rules: rules as ProxyRuleSetWithRulesResponseDto['rules'],
    };
  }

  /**
   * Export a rule set as the canonical v2 envelope (`GET :id/export`).
   *
   * Same authorization as getById: any authenticated caller whose API key
   * scope (if any) matches the rule set's project. Rules are serialized via
   * export-format.util — header `add` secret values are blanked there, so no
   * secret ever leaves this method. Schema definitions referenced by pipeline
   * rules are bundled as `{id, name, fields}` for portability; a referenced
   * schema that is missing or belongs to another project is skipped silently,
   * leaving an unbundled reference (parity with the frontend exporter this
   * endpoint replaces — closes #448, where the frontend copy dropped
   * `methods`).
   */
  async exportRuleSet(id: string, apiKeyProjectId?: string | null): Promise<RuleSetExport> {
    const ruleSet = await this.findById(id);
    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, ruleSet.projectId);

    // Decrypted headerConfig — serializeRuleForExport blanks the add values
    const rules = await this.proxyRulesService.getRulesByRuleSetId(id);
    const serializedRules = rules.map((rule) => serializeRuleForExport(rule));

    // Bundle the schema definitions the pipeline rules depend on (definitions
    // only — name + fields, never data rows)
    const schemas: ExportedSchema[] = [];
    for (const schemaId of collectSchemaIds(serializedRules)) {
      const schema = await this.pipelineSchemasService.getById(schemaId);
      // Skip silently: missing refs stay unbundled; never bundle another
      // project's schema definition
      if (!schema || schema.projectId !== ruleSet.projectId) continue;
      schemas.push({ id: schema.id, name: schema.name, fields: schema.fields });
    }

    return buildExportEnvelope({
      ruleSet: {
        name: ruleSet.name,
        description: ruleSet.description,
        environment: ruleSet.environment,
      },
      rules: serializedRules,
      schemas,
      exportedAt: new Date().toISOString(),
    });
  }

  /**
   * Create a new rule set
   */
  async create(
    projectId: string,
    dto: CreateProxyRuleSetDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetResponseDto> {
    // Verify project exists
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Check for duplicate name within project
    const existing = await this.findByName(projectId, dto.name);
    if (existing) {
      throw new ConflictException(`A rule set with name "${dto.name}" already exists in this project`);
    }

    const [ruleSet] = await db
      .insert(proxyRuleSets)
      .values({
        projectId,
        name: dto.name,
        description: dto.description,
        environment: dto.environment,
      })
      .returning();

    this.logger.log(`Created proxy rule set: ${dto.name} for project ${projectId}`);

    return ruleSet;
  }

  /**
   * Update a rule set
   */
  async update(
    id: string,
    dto: UpdateProxyRuleSetDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetResponseDto> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Check for duplicate name if changing
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.findByName(existing.projectId, dto.name);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A rule set with name "${dto.name}" already exists in this project`);
      }
    }

    const updateData: Partial<typeof proxyRuleSets.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.environment !== undefined) updateData.environment = dto.environment;

    const [updated] = await db
      .update(proxyRuleSets)
      .set(updateData)
      .where(eq(proxyRuleSets.id, id))
      .returning();

    this.logger.log(`Updated proxy rule set ${id}`);

    return updated;
  }

  /**
   * Copy a rule set with all its rules
   */
  async copy(
    id: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    // Get the existing rule set
    const existingRuleSet = await this.findById(id);
    if (!existingRuleSet) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      existingRuleSet.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Get the rules directly from database (with full schema type)
    const existingRules = await this.proxyRulesService.getRulesByRuleSetId(id);

    // Generate a unique name for the copy
    let copyName = `${existingRuleSet.name} (Copy)`;
    let copyIndex = 1;
    while (await this.findByName(existingRuleSet.projectId, copyName)) {
      copyIndex++;
      copyName = `${existingRuleSet.name} (Copy ${copyIndex})`;
    }

    // Create the new rule set
    const [newRuleSet] = await db
      .insert(proxyRuleSets)
      .values({
        projectId: existingRuleSet.projectId,
        name: copyName,
        description: existingRuleSet.description,
        environment: existingRuleSet.environment,
      })
      .returning();

    // Copy all rules from the original rule set
    const copiedRules: (typeof proxyRules.$inferSelect)[] = [];
    for (const rule of existingRules) {
      const [newRule] = await db
        .insert(proxyRules)
        .values({
          ruleSetId: newRuleSet.id,
          pathPattern: rule.pathPattern,
          method: rule.method,
          methods: rule.methods ?? null,
          targetUrl: rule.targetUrl,
          stripPrefix: rule.stripPrefix,
          order: rule.order,
          timeout: rule.timeout,
          preserveHost: rule.preserveHost,
          forwardCookies: rule.forwardCookies,
          headerConfig: rule.headerConfig,
          authTransform: rule.authTransform,
          internalRewrite: rule.internalRewrite,
          proxyType: rule.proxyType,
          emailHandlerConfig: rule.emailHandlerConfig,
          pipelineConfig: rule.pipelineConfig,
          isEnabled: rule.isEnabled,
          description: rule.description,
        })
        .returning();
      copiedRules.push(newRule);
    }

    this.logger.log(`Copied proxy rule set ${id} to ${newRuleSet.id} with ${copiedRules.length} rules`);

    return {
      ...newRuleSet,
      rules: copiedRules as ProxyRuleSetWithRulesResponseDto['rules'],
    };
  }

  /**
   * Import a rule set (and all its rules) from an exported JSON definition.
   *
   * Mirrors copy() — rules are inserted directly rather than going through
   * ProxyRulesService.create(), so there is no per-rule nginx regeneration
   * (a freshly imported set is not yet attached to any alias) and no
   * email-service / SSRF re-validation beyond the DTO validation already
   * performed at the controller boundary. Header `add` values are encrypted
   * before storage so they round-trip correctly with the rest of the system.
   */
  async importRuleSet(
    projectId: string,
    dto: ImportProxyRuleSetDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    // Verify project exists
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Resolve bundled schema dependencies to target-project schema ids.
    // Pipeline rules carry the original (source) schema ids; we build a map and
    // remap every schema reference in the pipeline configs before insert.
    const idMap = new Map<string, string>();
    const schemaResolutions = dto.schemas ?? [];
    if (schemaResolutions.length > 0) {
      const existingSchemas = await this.pipelineSchemasService.getByProjectId(
        projectId,
        apiKeyProjectId,
      );
      const existingNames = new Set(existingSchemas.map((s) => s.name));

      for (const res of schemaResolutions) {
        if (res.action === 'reuse') {
          if (!res.targetSchemaId) {
            throw new BadRequestException(
              `Schema "${res.name}" is set to reuse but no targetSchemaId was provided`,
            );
          }
          const target = await this.pipelineSchemasService.getById(res.targetSchemaId);
          if (!target || target.projectId !== projectId) {
            throw new BadRequestException(
              `Target schema ${res.targetSchemaId} not found in this project`,
            );
          }
          idMap.set(res.sourceId, target.id);
        } else {
          // create — auto-suffix on name conflict so import never hard-fails
          let schemaName = res.name;
          if (existingNames.has(schemaName)) {
            let suffix = 2;
            while (existingNames.has(`${res.name} (${suffix})`)) suffix++;
            schemaName = `${res.name} (${suffix})`;
          }
          existingNames.add(schemaName);
          const created = await this.pipelineSchemasService.create(
            { projectId, name: schemaName, fields: res.fields },
            userId,
            userRole,
            apiKeyProjectId,
          );
          idMap.set(res.sourceId, created.id);
        }
      }
    }

    // Generate a unique name, appending "(Imported)" on collision
    const baseName = dto.ruleSet.name?.trim() || 'Imported Rule Set';
    let name = baseName;
    if (await this.findByName(projectId, name)) {
      name = `${baseName} (Imported)`;
      let importIndex = 1;
      while (await this.findByName(projectId, name)) {
        importIndex++;
        name = `${baseName} (Imported ${importIndex})`;
      }
    }

    const [newRuleSet] = await db
      .insert(proxyRuleSets)
      .values({
        projectId,
        name,
        description: dto.ruleSet.description,
        environment: dto.ruleSet.environment,
      })
      .returning();

    // Remap schema references to the resolved target-project ids, then insert
    // rules in their declared order so evaluation order is preserved
    const sourceRules = idMap.size > 0 ? remapSchemaIds(dto.rules ?? [], idMap) : dto.rules ?? [];
    const rules = [...sourceRules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      await db.insert(proxyRules).values({
        ruleSetId: newRuleSet.id,
        pathPattern: rule.pathPattern,
        method: rule.method ?? null,
        methods: rule.methods ?? null,
        targetUrl: rule.targetUrl ?? '',
        stripPrefix: rule.stripPrefix ?? true,
        order: rule.order ?? i,
        timeout: rule.timeout ?? 30000,
        preserveHost: rule.preserveHost ?? false,
        forwardCookies: rule.forwardCookies ?? false,
        headerConfig: this.proxyRulesService.encryptHeaderConfigForStorage(rule.headerConfig),
        authTransform: rule.authTransform ?? null,
        internalRewrite: rule.internalRewrite ?? false,
        proxyType: (rule.proxyType as ProxyType) ?? 'external_proxy',
        emailHandlerConfig: rule.emailHandlerConfig ?? null,
        pipelineConfig: (rule.pipelineConfig as PipelineConfig) ?? null,
        isEnabled: rule.isEnabled ?? true,
        debugEnabled: rule.debugEnabled ?? false,
        description: rule.description,
      });
    }

    this.logger.log(
      `Imported proxy rule set "${name}" (${rules.length} rules) for project ${projectId}`,
    );

    const insertedRules = await this.proxyRulesService.getRulesByRuleSetId(newRuleSet.id);

    return {
      ...newRuleSet,
      rules: insertedRules as ProxyRuleSetWithRulesResponseDto['rules'],
    };
  }

  /**
   * Resolve bundled schema definitions against the target project by NAME —
   * the non-interactive counterpart of importRuleSet's resolution block, for
   * the sync path (Task 6/7 of the Phase 1 plan). No `ImportSchemaResolutionDto`
   * choices anywhere: the name IS the identity.
   *
   * Per bundled schema `{id, name, fields}`:
   * - A project schema with the same name exists → `action: 'reuse'`, map
   *   `sourceId → existing.id`. Field definitions are compared
   *   (compareSchemaFields); a divergence sets `fieldMismatch: true` and
   *   appends `Schema "<name>": <mismatch>` entries to `warnings[]` (design
   *   decision 4: warnings by default).
   * - No name match → `action: 'create'`. Live: created via
   *   `pipelineSchemasService.create` with the EXACT name (no auto-suffixing,
   *   unlike import — the name is the identity). Under `dryRun`, nothing is
   *   created and `targetSchemaId` stays `null`.
   *
   * `strictSchemas` turns field mismatches into a single BadRequestException
   * listing EVERY mismatched schema (CI wants the full list, not the first).
   * ORDERING GUARANTEE: the strict throw happens after ALL schemas are
   * examined but BEFORE any schema creation, so a failed strict sync has zero
   * side effects — the sync endpoint (Task 7) relies on this to keep dry
   * failures write-free even though schema creation runs outside the rule
   * transaction.
   *
   * Duplicate names WITHIN the incoming schemas → 400 (ambiguous payload).
   * Empty/undefined schemas → empty result with no DB access.
   */
  private async resolveSchemasByName(
    projectId: string,
    schemas: { id: string; name: string; fields: ComparableSchemaField[] }[] | undefined,
    options: { strictSchemas: boolean; dryRun: boolean },
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<{ idMap: Map<string, string>; resolutions: SchemaResolution[]; warnings: string[] }> {
    const idMap = new Map<string, string>();
    const resolutions: SchemaResolution[] = [];
    const warnings: string[] = [];

    if (!schemas || schemas.length === 0) {
      return { idMap, resolutions, warnings };
    }

    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    for (const schema of schemas) {
      if (seenNames.has(schema.name)) {
        throw new BadRequestException(
          `Duplicate schema name "${schema.name}" in payload: schema names identify schemas, so each may appear only once`,
        );
      }
      seenNames.add(schema.name);
      if (seenIds.has(schema.id)) {
        throw new BadRequestException(
          `Duplicate schema id "${schema.id}" in payload: rule schema-refs remap by source id, so each may appear only once`,
        );
      }
      seenIds.add(schema.id);
    }

    const existingSchemas = await this.pipelineSchemasService.getByProjectId(
      projectId,
      apiKeyProjectId,
    );
    const existingByName = new Map(existingSchemas.map((s) => [s.name, s]));

    // Pass 1 — examine everything (reuse resolutions + pending creates) so the
    // strict throw can list ALL mismatches and precede ANY creation.
    const pendingCreates: { schema: (typeof schemas)[number]; resolution: SchemaResolution }[] = [];
    const strictFailures: string[] = [];
    for (const schema of schemas) {
      const existing = existingByName.get(schema.name);
      if (existing) {
        const { match, mismatches } = compareSchemaFields(schema.fields, existing.fields);
        idMap.set(schema.id, existing.id);
        resolutions.push({
          name: schema.name,
          action: 'reuse',
          targetSchemaId: existing.id,
          fieldMismatch: !match,
        });
        for (const mismatch of mismatches) {
          warnings.push(`Schema "${schema.name}": ${mismatch}`);
          strictFailures.push(`Schema "${schema.name}": ${mismatch}`);
        }
      } else {
        const resolution: SchemaResolution = {
          name: schema.name,
          action: 'create',
          targetSchemaId: null,
          fieldMismatch: false,
        };
        resolutions.push(resolution);
        pendingCreates.push({ schema, resolution });
      }
    }

    // Strict failures throw even under dryRun: CI's --strict-schemas --dry-run
    // must fail the check loudly, not return a green-looking report.
    if (options.strictSchemas && strictFailures.length > 0) {
      throw new BadRequestException(
        `Schema field mismatch (strictSchemas): ${strictFailures.join('; ')}`,
      );
    }

    // Pass 2 — perform creations (live sync only; dryRun reports the plan with
    // targetSchemaId null and touches nothing).
    if (!options.dryRun) {
      for (const { schema, resolution } of pendingCreates) {
        const created = await this.pipelineSchemasService.create(
          { projectId, name: schema.name, fields: schema.fields },
          userId,
          userRole,
          apiKeyProjectId,
        );
        idMap.set(schema.id, created.id);
        resolution.targetSchemaId = created.id;
      }
    }

    return { idMap, resolutions, warnings };
  }

  /**
   * Delete a rule set (cascades to rules and join table rows)
   */
  async delete(
    id: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }

    await this.permissionsService.requireProjectAccess(
      existing.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

    // Check if this rule set is being used as a default
    const [projectUsingDefault] = await db
      .select()
      .from(projects)
      .where(eq(projects.defaultProxyRuleSetId, id))
      .limit(1);

    if (projectUsingDefault) {
      throw new ConflictException(
        'Cannot delete rule set that is set as the project default. ' +
          'Remove it as the default first.',
      );
    }

    // Find aliases that use this rule set (via join table) so we can regenerate nginx after
    const affectedJoinRows = await db
      .select({ aliasId: aliasProxyRuleSets.aliasId })
      .from(aliasProxyRuleSets)
      .where(eq(aliasProxyRuleSets.proxyRuleSetId, id));

    // Also find aliases using the legacy column
    const affectedLegacyAliases = await db
      .select({ id: deploymentAliases.id, projectId: deploymentAliases.projectId, alias: deploymentAliases.alias })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.proxyRuleSetId, id));

    // Collect unique alias info for nginx regeneration
    const aliasIdsFromJoin = affectedJoinRows.map((r) => r.aliasId);
    const affectedAliases: { projectId: string; alias: string }[] = [...affectedLegacyAliases];

    if (aliasIdsFromJoin.length > 0) {
      const joinAliases = await db
        .select({ projectId: deploymentAliases.projectId, alias: deploymentAliases.alias })
        .from(deploymentAliases)
        .where(
          inArray(deploymentAliases.id, aliasIdsFromJoin),
        );
      affectedAliases.push(...joinAliases);
    }

    // Deduplicate by projectId+alias
    const uniqueAliases = Array.from(
      new Map(affectedAliases.map((a) => [`${a.projectId}:${a.alias}`, a])).values(),
    );

    // Delete rule set — cascades to proxy_rules and alias_proxy_rule_sets rows
    // Also clear legacy column on affected aliases (set null since ON DELETE SET NULL handles this)
    await db.delete(proxyRuleSets).where(eq(proxyRuleSets.id, id));

    // Regenerate nginx for affected aliases
    for (const alias of uniqueAliases) {
      try {
        await this.nginxRegenerationService.regenerateForAlias(alias.projectId, alias.alias);
      } catch (error) {
        this.logger.warn(`Failed to regenerate nginx for alias ${alias.alias}: ${error.message}`);
      }
    }

    this.logger.log(`Deleted proxy rule set ${id}, regenerated nginx for ${uniqueAliases.length} aliases`);
  }

  // ==================== Helper Methods ====================

  private async findById(id: string) {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, id))
      .limit(1);

    return ruleSet || null;
  }

  private async findByName(projectId: string, name: string) {
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(and(eq(proxyRuleSets.projectId, projectId), eq(proxyRuleSets.name, name)))
      .limit(1);

    return ruleSet || null;
  }
}
