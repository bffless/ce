import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import * as crypto from 'crypto';
import { db } from '../db/client';
import {
  proxyRuleSets,
  proxyRules,
  projects,
  aliasProxyRuleSets,
  deploymentAliases,
  projectSecrets,
} from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import type { SchemaKind } from '../db/schema/pipeline-schemas.schema';
import { LintableSchema, UploadSchemaLintService } from '../pipelines/upload-schema-lint.service';
import { collectUploadStepRefs } from '../pipelines/upload-schema-contract';
import {
  ProxyRuleSetRevisionsService,
  computeRevisionHash,
} from './proxy-rule-set-revisions.service';
import {
  CreateProxyRuleSetDto,
  UpdateProxyRuleSetDto,
  ProxyRuleSetResponseDto,
  ProxyRuleSetWithRulesResponseDto,
  ImportProxyRuleSetDto,
  SyncProxyRuleSetDto,
  SyncProxyRuleSetResponseDto,
  SyncRuleRefDto,
  RevisionListResponseDto,
  RevisionListItemDto,
  RevisionDetailResponseDto,
} from './dto';
import type {
  PipelineConfig,
  ProxyHeaderConfig,
  ProxyRule,
  ProxyType,
} from '../db/schema/proxy-rules.schema';
import type { ProxyRuleSet, ProxyRuleSetSource } from '../db/schema/proxy-rule-sets.schema';
import type {
  ProxyRuleSetRevision,
  RevisionTrigger,
} from '../db/schema/proxy-rule-set-revisions.schema';
import { ProxyRulesService } from './proxy-rules.service';
import { collectSchemaIds, remapSchemaIds } from './schema-refs.util';
import {
  compareSchemaFields,
  type ComparableSchemaField,
  type SchemaResolution,
} from './schema-sync.util';
import {
  buildExportEnvelope,
  canonicalRuleCompare,
  serializeRuleForExport,
  type ExportedSchema,
  type RuleSetExport,
} from './export-format.util';
import {
  computeSyncPlan,
  normalizeSyncRules,
  type LiveSyncRule,
  type NormalizedSyncRule,
  type SyncPlan,
  type SyncRuleInput,
  type SyncRuleRef,
} from './sync-plan.util';

/**
 * `{{secrets.NAME}}` reference pattern, matching the pipeline execution layer's
 * interpolation (`pipelines/execution/expression-evaluator.ts`). Used to report
 * referenced-but-missing project secrets at sync time (warning-level only).
 */
const SECRET_REF_PATTERN = /\{\{\s*secrets\.([A-Za-z0-9_-]+)\s*\}\}/g;

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
    private readonly proxyRuleSetRevisionsService: ProxyRuleSetRevisionsService,
    @Inject(forwardRef(() => UploadSchemaLintService))
    private readonly uploadSchemaLint: UploadSchemaLintService,
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
      schemas.push({
        id: schema.id,
        name: schema.name,
        ...(schema.kind ? { kind: schema.kind } : {}),
        fields: schema.fields,
      });
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
   * List all captured revisions for a rule set, newest first (`GET
   * :id/revisions`). Same read-level authorization as `exportRuleSet`
   * (API key project scope only — any authenticated caller whose API key
   * scope, if any, matches the rule set's project). `current` is computed by
   * hashing the LIVE envelope once per call (via
   * `ProxyRuleSetRevisionsService.buildCurrentEnvelope`, the same assembly
   * `capture()` uses) and comparing against each revision's stored
   * `contentHash`.
   */
  async listRevisions(
    ruleSetId: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<RevisionListResponseDto> {
    const ruleSet = await this.findById(ruleSetId);
    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${ruleSetId} not found`);
    }

    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, ruleSet.projectId);

    const revisions = await this.proxyRuleSetRevisionsService.listRevisions(ruleSetId);
    const liveHash = await this.computeLiveHash(ruleSet);

    return {
      revisions: revisions.map((revision) => this.toRevisionListItem(revision, liveHash)),
    };
  }

  /**
   * Get a single captured revision plus its full snapshot (`GET
   * :id/revisions/:revisionId`). Same authorization as `listRevisions`.
   * 404s when the revision doesn't exist or belongs to another rule set
   * (`ProxyRuleSetRevisionsService.getRevision` scopes the lookup to
   * `ruleSetId`, so both cases resolve to `null`).
   */
  async getRevision(
    ruleSetId: string,
    revisionId: string,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<RevisionDetailResponseDto> {
    const ruleSet = await this.findById(ruleSetId);
    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${ruleSetId} not found`);
    }

    this.permissionsService.enforceApiKeyProjectScope(apiKeyProjectId, ruleSet.projectId);

    const revision = await this.proxyRuleSetRevisionsService.getRevision(ruleSetId, revisionId);
    if (!revision) {
      throw new NotFoundException(`Revision ${revisionId} not found`);
    }

    const liveHash = await this.computeLiveHash(ruleSet);

    return {
      ...this.toRevisionListItem(revision, liveHash),
      snapshot: revision.snapshot as unknown as RevisionDetailResponseDto['snapshot'],
    };
  }

  /**
   * Replay a captured revision's snapshot through `syncRuleSet` (`POST
   * :id/rollback/:revisionId`) — "history only moves forward", like `git
   * revert`: rollback never rewrites the past, it applies the OLD state as a
   * NEW sync.
   *
   * 404s exactly like `getRevision` (missing set, or missing/foreign
   * revision — `ProxyRuleSetRevisionsService.getRevision` scopes the lookup
   * to `ruleSetId`, so both collapse to `null`). Authorization is enforced by
   * `syncRuleSet` itself (contributor-level `requireProjectAccess` against
   * the SET'S OWN `projectId` — never a caller-supplied one), so this method
   * does no separate permission check before that call.
   *
   * The snapshot's `ruleSet.name` is NEVER applied: rollback must not
   * rename or (re)create a set, so the sync DTO always forces the CURRENT
   * name, and a warning is appended when the snapshot's name differs.
   * `options.prune` is always `true` (a rollback restores the snapshot's
   * rule set exactly — live-only rules are deleted, not left as
   * pruneCandidates); `dryRun` passes through verbatim.
   *
   * Trigger threading: `syncRuleSet`'s own post-commit capture call
   * defaults to trigger `'sync'`; this method passes the `'rollback'`
   * override so a non-dryRun rollback captures exactly ONE new revision,
   * with the right trigger — not a `'sync'` + `'rollback'` pair.
   *
   * Inherited limitation (not fixed here): a snapshot of a methods-split set
   * fails replay with the same 400 `syncRuleSet` gives today; that error
   * surfaces as-is.
   */
  async rollbackToRevision(
    ruleSetId: string,
    revisionId: string,
    options: { dryRun?: boolean },
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<SyncProxyRuleSetResponseDto> {
    const existingSet = await this.findById(ruleSetId);
    if (!existingSet) {
      throw new NotFoundException(`Rule set ${ruleSetId} not found`);
    }

    const revision = await this.proxyRuleSetRevisionsService.getRevision(ruleSetId, revisionId);
    if (!revision) {
      throw new NotFoundException(`Revision ${revisionId} not found`);
    }

    const snapshot = revision.snapshot as unknown as RuleSetExport;
    const dryRun = options.dryRun ?? false;

    const rollbackWarnings: string[] = [
      `Rolled back to revision ${revisionId} (captured ${revision.createdAt.toISOString()}, ` +
        `originally triggered by '${revision.trigger}').`,
    ];
    if (snapshot.ruleSet.name !== existingSet.name) {
      rollbackWarnings.push(
        `Snapshot rule set name "${snapshot.ruleSet.name}" differs from the current name ` +
          `"${existingSet.name}"; rollback never renames or creates a rule set, so the current ` +
          `name was kept.`,
      );
    }

    const dto = {
      ruleSet: { ...snapshot.ruleSet, name: existingSet.name },
      rules: snapshot.rules,
      schemas: snapshot.schemas,
      options: { prune: true, dryRun },
    } as unknown as SyncProxyRuleSetDto;

    const result = await this.syncRuleSet(
      existingSet.projectId,
      dto,
      userId,
      userRole,
      apiKeyProjectId,
      'rollback',
    );

    return { ...result, warnings: [...rollbackWarnings, ...result.warnings] };
  }

  /** Hash of the LIVE envelope for `ruleSet`, for the `current` flag comparison. */
  private async computeLiveHash(ruleSet: ProxyRuleSet): Promise<string> {
    const rules = await this.proxyRulesService.getRulesByRuleSetId(ruleSet.id);
    const liveEnvelope = await this.proxyRuleSetRevisionsService.buildCurrentEnvelope(
      ruleSet,
      rules,
    );
    return computeRevisionHash(liveEnvelope);
  }

  private toRevisionListItem(
    revision: ProxyRuleSetRevision,
    liveHash: string,
  ): RevisionListItemDto {
    return {
      id: revision.id,
      createdAt: revision.createdAt.toISOString(),
      trigger: revision.trigger,
      contentHash: revision.contentHash,
      ruleCount: revision.snapshot.rules.length,
      current: revision.contentHash === liveHash,
      source: revision.source ?? null,
    };
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
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

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
      throw new ConflictException(
        `A rule set with name "${dto.name}" already exists in this project`,
      );
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

    // Post-commit, best-effort: a freshly created set has no rules yet, but
    // capturing establishes revision history from the start (and costs
    // nothing extra — the hash-dedupe means an empty-set capture is cheap).
    await this.captureRevisionSafely({ ruleSet, rules: [], trigger: 'create', userId });

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
        throw new ConflictException(
          `A rule set with name "${dto.name}" already exists in this project`,
        );
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

    // Post-commit, best-effort: metadata-only change, but still worth a
    // snapshot (current rules are unaffected by this mutation). Reload is
    // wrapped too — a failure here must not turn a successful update into a
    // failed request.
    try {
      const currentRules = await this.proxyRulesService.getRulesByRuleSetId(id);
      await this.captureRevisionSafely({
        ruleSet: updated,
        rules: currentRules,
        trigger: 'set_update',
        userId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to reload rules for set_update revision capture on rule set ${id}: ${(error as Error).message}`,
      );
    }

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

    // Copy all rules from the original rule set. existingRules arrive DECRYPTED
    // (getRulesByRuleSetId decrypts header `add` values), so they must be
    // re-encrypted on the way back into storage — same as importRuleSet.
    for (const rule of existingRules) {
      await db.insert(proxyRules).values({
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
        headerConfig: this.proxyRulesService.encryptHeaderConfigForStorage(rule.headerConfig),
        authTransform: rule.authTransform,
        internalRewrite: rule.internalRewrite,
        proxyType: rule.proxyType,
        emailHandlerConfig: rule.emailHandlerConfig,
        pipelineConfig: rule.pipelineConfig,
        isEnabled: rule.isEnabled,
        description: rule.description,
      });
    }

    this.logger.log(
      `Copied proxy rule set ${id} to ${newRuleSet.id} with ${existingRules.length} rules`,
    );

    // Read the rules back decrypted: both the revision snapshot and the API
    // response carry plaintext header values, not the stored ciphertext.
    const copiedRules = await this.proxyRulesService.getRulesByRuleSetId(newRuleSet.id);

    // Post-commit, best-effort: snapshot the copy's own rules (not the
    // source set's revisions — the copy is a new set with its own history).
    await this.captureRevisionSafely({
      ruleSet: newRuleSet,
      rules: copiedRules,
      trigger: 'copy',
      userId,
    });

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
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

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
    const sourceRules = idMap.size > 0 ? remapSchemaIds(dto.rules ?? [], idMap) : (dto.rules ?? []);
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

    // Post-commit, best-effort: an imported set arrives from an external
    // source (export file / git-synced repo) — capture establishes the
    // baseline revision for this instance's own history.
    await this.captureRevisionSafely({
      ruleSet: newRuleSet,
      rules: insertedRules,
      trigger: 'import',
      userId,
    });

    return {
      ...newRuleSet,
      rules: insertedRules as ProxyRuleSetWithRulesResponseDto['rules'],
    };
  }

  /**
   * Warn when a rule's upload step targets a schema that doesn't declare the
   * fields upload handlers write (bffless/ce#630).
   *
   * Warning-level only, matching the schema-mismatch policy above: files still
   * upload and the record is still correct, so a hard failure would break
   * pushes for a metadata declaration. `--strict-schemas` deliberately does NOT
   * cover this — that flag means "live schema drift", and extending it would
   * fail CI for anyone whose upload schema was always partial.
   *
   * Schema fields come from the payload bundle when present (the shape the
   * schema WILL have, including under `dryRun` where nothing is written), and
   * from the project's live schemas otherwise. Payload entries are indexed
   * under both their source id and their remapped target id, because `dryRun`
   * creates have no target id to remap to.
   */
  private async lintUploadSchemas(
    projectId: string,
    rules: SyncRuleInput[],
    payloadSchemas: { id: string; name: string; fields: ComparableSchemaField[] }[] | undefined,
    idMap: Map<string, string>,
    apiKeyProjectId?: string | null,
  ): Promise<string[]> {
    const referenced = rules.flatMap((rule) => collectUploadStepRefs(rule.pipelineConfig));
    if (referenced.length === 0) return [];

    const byId = new Map<string, LintableSchema>();
    for (const schema of payloadSchemas ?? []) {
      const entry: LintableSchema = { name: schema.name.trim(), fields: schema.fields };
      byId.set(schema.id, entry);
      const targetId = idMap.get(schema.id);
      if (targetId) byId.set(targetId, entry);
    }

    if (referenced.some((ref) => !byId.has(ref.schemaId))) {
      const live = await this.pipelineSchemasService.getByProjectId(projectId, apiKeyProjectId);
      for (const schema of live) {
        if (!byId.has(schema.id)) byId.set(schema.id, { name: schema.name, fields: schema.fields });
      }
    }

    const warnings: string[] = [];
    const seen = new Set<string>();
    for (const rule of rules) {
      for (const warning of this.uploadSchemaLint.lintWithFields(rule.pipelineConfig, (id) =>
        byId.get(id),
      )) {
        // Two rules sharing one bad schema is one problem, not two.
        if (seen.has(warning)) continue;
        seen.add(warning);
        warnings.push(warning);
      }
    }
    return warnings;
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
    schemas:
      | { id: string; name: string; kind?: SchemaKind; fields: ComparableSchemaField[] }[]
      | undefined,
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
    const pendingKindAdoptions: { schemaId: string; kind: SchemaKind }[] = [];
    const strictFailures: string[] = [];
    for (const schema of schemas) {
      const existing = existingByName.get(schema.name);
      if (existing) {
        const { match, mismatches } = compareSchemaFields(schema.fields, existing.fields);
        idMap.set(schema.id, existing.id);

        // Kind is adopted, never overwritten: filling a null is unambiguous and
        // is the only route by which a schema that predates the column can ever
        // declare itself. A real disagreement warns and leaves the live value —
        // silently reclassifying someone's schema from a config file is not a
        // change a push should make on its own (bffless/ce#633).
        const kindAdopted = Boolean(schema.kind) && !existing.kind;
        if (schema.kind && existing.kind && schema.kind !== existing.kind) {
          warnings.push(
            `Schema "${schema.name}": declared kind "${schema.kind}" but the live schema is ` +
              `"${existing.kind}" — keeping the live kind. Change it in the dashboard if the ` +
              `payload is right.`,
          );
        }
        if (kindAdopted) pendingKindAdoptions.push({ schemaId: existing.id, kind: schema.kind! });

        resolutions.push({
          name: schema.name,
          action: 'reuse',
          targetSchemaId: existing.id,
          fieldMismatch: !match,
          kindAdopted,
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
          // A schema created by this sync carries the payload's kind from birth;
          // nothing was adopted onto an existing row.
          kindAdopted: false,
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
      for (const { schemaId, kind } of pendingKindAdoptions) {
        await this.pipelineSchemasService.adoptKind(schemaId, kind);
      }
      for (const { schema, resolution } of pendingCreates) {
        const created = await this.pipelineSchemasService.create(
          { projectId, name: schema.name, fields: schema.fields, kind: schema.kind },
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
   * Idempotently sync a rule set from a rules-as-code payload
   * (`PUT project/:projectId/sync` — Task 7 of the Phase 1 plan).
   *
   * The payload is the desired declarative state: rules match live rows on
   * `(pathPattern, method ?? null)` via {@link computeSyncPlan}; matched rules
   * are updated only when a portable field actually differs, live-only rules
   * are deleted only under `options.prune` (otherwise reported as
   * `pruneCandidates`), and bundled schemas resolve by NAME
   * ({@link resolveSchemasByName} — decision 4: mismatches warn, or 400 under
   * `options.strictSchemas`).
   *
   * Blank-secret handling (decision 1): an incoming empty-string
   * `headerConfig.add` value means "keep the live value" — the live decrypted
   * value is substituted before re-encryption on updates; on NEW rules there
   * is nothing to preserve, so `''` is stored and the header name reported in
   * `missingSecrets[]`. The plan's rule objects (which may alias the request
   * DTO) are never mutated — fresh headerConfig objects are built instead.
   *
   * `options.dryRun` returns the full response with ZERO writes: no set
   * create, no schema create, no rule writes, no source stamp, no nginx.
   * Note: under dryRun the schema idMap has no entries for to-be-created
   * schemas, so rules referencing them keep their source ids in the dry-run
   * diff — tolerated, since those rules are creates anyway.
   *
   * Live syncs perform ALL rule-set/rule writes in ONE `db.transaction`
   * (schema creation runs before it, outside — see resolveSchemasByName's
   * ordering guarantee), then regenerate nginx for the set (a synced set may
   * be attached to live aliases, unlike import); a regeneration failure is
   * appended to `warnings[]`, never a 500, because the DB state is already
   * committed. `source` is re-stamped (fresh `syncedAt`/`contentHash`) on
   * every non-dryRun sync, even a no-op one.
   *
   * Response arrays are sorted by `(pathPattern, method)` so CI output is
   * byte-stable.
   */
  async syncRuleSet(
    projectId: string,
    dto: SyncProxyRuleSetDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
    // Internal-only: overrides the trigger captured on the post-commit
    // revision (default `'sync'`). Used by `rollbackToRevision`, which
    // replays a snapshot THROUGH this method but must capture a `'rollback'`
    // revision, not a `'sync'` one — never set by the controller.
    captureTrigger?: RevisionTrigger,
  ): Promise<SyncProxyRuleSetResponseDto> {
    // Verify project exists (import parity)
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

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

    const name = dto.ruleSet.name?.trim();
    if (!name) {
      throw new BadRequestException('ruleSet.name must be a non-empty string');
    }

    const prune = dto.options?.prune ?? false;
    const conflictPolicy = dto.options?.conflictPolicy ?? 'overwrite';
    const dryRun = dto.options?.dryRun ?? false;
    const strictSchemas = dto.options?.strictSchemas ?? false;

    // Same bridging as importRuleSet: the DTO config classes are structural
    // mirrors of the schema's config types.
    const dtoRules = (dto.rules ?? []) as unknown as SyncRuleInput[];

    // Early duplicate-(pathPattern, method) detection: against an empty live
    // set the only possible computeSyncPlan throw is the duplicate-key error,
    // and catching it HERE (before schema resolution) keeps a 400 payload from
    // creating schemas first — schema creation runs outside the rule
    // transaction, so it would otherwise survive the failure.
    try {
      computeSyncPlan([], dtoRules, { prune: false });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const { idMap, resolutions, warnings } = await this.resolveSchemasByName(
      projectId,
      dto.schemas?.map((schema) => ({
        id: schema.id,
        name: schema.name.trim(),
        kind: schema.kind,
        fields: schema.fields,
      })),
      { strictSchemas, dryRun },
      userId,
      userRole,
      apiKeyProjectId,
    );

    // Remap schema references to target-project ids. remapSchemaIds deep-clones;
    // with an empty idMap the rules still alias the request DTO, so downstream
    // code must not mutate them in place.
    const incomingRules = idMap.size > 0 ? remapSchemaIds(dtoRules, idMap) : dtoRules;

    // Advisory: an upload step whose target schema doesn't declare what upload
    // handlers write. Runs on the remapped rules so ids match the target
    // project, and before any writing so `dryRun` reports it too.
    warnings.push(
      ...(await this.lintUploadSchemas(
        projectId,
        incomingRules,
        dto.schemas,
        idMap,
        apiKeyProjectId,
      )),
    );

    const existing = await this.findByName(projectId, name);
    const setCreated = !existing;
    const liveRules = existing ? await this.proxyRulesService.getRulesByRuleSetId(existing.id) : [];

    // Backfill, pre-mutation: sync on an existing set is a destructive path
    // (rules can be updated/deleted), so if this set predates revision
    // history entirely, snapshot its current (pre-sync) state first. No-ops
    // when a revision already exists or the set has no rules. Never runs
    // under dryRun — a preview must not write anything.
    if (existing && !dryRun) {
      try {
        await this.proxyRuleSetRevisionsService.captureIfUnrevisioned({
          ruleSet: existing,
          rules: liveRules,
          userId,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to backfill pre-sync revision for rule set ${existing.id}: ${(error as Error).message}`,
        );
      }
    }

    // Three-way base: what THIS sync last wrote. Only loaded when a caller asks
    // to preserve local edits (app upgrades); rules-as-code CI leaves it off so
    // the repo stays the single source of truth. A set with no prior `sync`
    // revision — a first sync, or one predating revision history — simply has
    // no base and falls back to today's two-way comparison.
    let baseRules: SyncRuleInput[] | undefined;
    if (existing && conflictPolicy === 'preserve') {
      try {
        const baseRevision = await this.proxyRuleSetRevisionsService.latestByTrigger(
          existing.id,
          'sync',
        );
        baseRules = baseRevision?.snapshot?.rules as SyncRuleInput[] | undefined;
      } catch (error) {
        this.logger.warn(
          `Failed to load sync base revision for rule set ${existing.id}; ` +
            `falling back to two-way sync: ${(error as Error).message}`,
        );
      }
    }

    let plan: SyncPlan;
    try {
      plan = computeSyncPlan(liveRules, incomingRules, {
        prune,
        ...(baseRules ? { baseRules, conflictPolicy } : {}),
      });
    } catch (error) {
      // Belt-and-braces: duplicates are already rejected above.
      throw new BadRequestException((error as Error).message);
    }

    const missingSecrets = await this.collectMissingSecrets(
      projectId,
      incomingRules,
      plan,
      liveRules,
    );
    const contentHash = this.computeSyncContentHash(
      { name, description: dto.ruleSet.description, environment: dto.ruleSet.environment },
      incomingRules,
    );

    const buildResponse = (ruleSetId: string | null): SyncProxyRuleSetResponseDto => ({
      ruleSetId,
      created: this.sortRuleRefs(plan.toCreate),
      updated: this.sortRuleRefs(plan.toUpdate),
      deleted: this.sortRuleRefs(plan.toDelete),
      unchanged: this.sortRuleRefs(plan.unchanged),
      pruneCandidates: this.sortRuleRefs(plan.pruneCandidates),
      preserved: this.sortRuleRefs(plan.preserved),
      merged: [...plan.merged].sort(
        (a, b) =>
          a.pathPattern.localeCompare(b.pathPattern) ||
          (a.method ?? '').localeCompare(b.method ?? ''),
      ),
      conflicts: [...plan.conflicts].sort(
        (a, b) =>
          a.pathPattern.localeCompare(b.pathPattern) ||
          (a.method ?? '').localeCompare(b.method ?? ''),
      ),
      schemaResolutions: resolutions,
      missingSecrets,
      warnings,
      dryRun,
      setCreated,
    });

    if (dryRun) {
      return buildResponse(existing?.id ?? null);
    }

    const syncedAt = new Date();
    const source: ProxyRuleSetSource = {
      syncedAt: syncedAt.toISOString(),
      contentHash,
    };
    if (dto.source?.repo !== undefined) source.repo = dto.source.repo;
    if (dto.source?.path !== undefined) source.path = dto.source.path;
    if (dto.source?.gitSha !== undefined) source.gitSha = dto.source.gitSha;

    // Decrypted live rules by match key, for blank-secret preservation on updates
    const liveByKey = new Map(
      liveRules.map((rule) => [JSON.stringify([rule.pathPattern, rule.method ?? null]), rule]),
    );

    let ruleSetId = existing?.id ?? '';
    // Post-sync row for revision capture below — the committed set row,
    // reconstructed from what we know was written (new-set insert result, or
    // the existing row merged with the fields the update actually touched).
    let postSyncRuleSet: ProxyRuleSet | null = null;
    await db.transaction(async (tx) => {
      if (!existing) {
        const [created] = await tx
          .insert(proxyRuleSets)
          .values({
            projectId,
            name,
            description: dto.ruleSet.description,
            environment: dto.ruleSet.environment,
            source,
          })
          .returning();
        ruleSetId = created.id;
        postSyncRuleSet = created;
      } else {
        // Source is re-stamped on EVERY live sync (fresh syncedAt/contentHash),
        // even when all rules are unchanged; description/environment only when
        // provided and actually different.
        const setUpdate: Partial<typeof proxyRuleSets.$inferInsert> = {
          source,
          updatedAt: syncedAt,
        };
        if (
          dto.ruleSet.description !== undefined &&
          dto.ruleSet.description !== existing.description
        ) {
          setUpdate.description = dto.ruleSet.description;
        }
        if (
          dto.ruleSet.environment !== undefined &&
          dto.ruleSet.environment !== existing.environment
        ) {
          setUpdate.environment = dto.ruleSet.environment;
        }
        await tx.update(proxyRuleSets).set(setUpdate).where(eq(proxyRuleSets.id, existing.id));
        postSyncRuleSet = { ...existing, ...setUpdate };
      }

      for (const entry of plan.toCreate) {
        // New rule: blank add values are stored as-is (encrypted '') and the
        // header names surface in missingSecrets — nothing live to preserve.
        await tx.insert(proxyRules).values({
          ruleSetId,
          ...this.syncRuleToRowValues(entry.rule, entry.rule.headerConfig),
        });
      }

      for (const entry of plan.toUpdate) {
        const live = liveByKey.get(JSON.stringify([entry.pathPattern, entry.method]));
        const headerConfig = this.preserveBlankHeaderValues(
          entry.rule.headerConfig,
          live?.headerConfig,
        );
        const where = entry.liveId
          ? eq(proxyRules.id, entry.liveId)
          : and(
              eq(proxyRules.ruleSetId, ruleSetId),
              eq(proxyRules.pathPattern, entry.pathPattern),
              entry.method === null
                ? isNull(proxyRules.method)
                : eq(proxyRules.method, entry.method),
            );
        await tx
          .update(proxyRules)
          .set({ ...this.syncRuleToRowValues(entry.rule, headerConfig), updatedAt: syncedAt })
          .where(where);
      }

      for (const ref of plan.toDelete) {
        await tx
          .delete(proxyRules)
          .where(
            and(
              eq(proxyRules.ruleSetId, ruleSetId),
              eq(proxyRules.pathPattern, ref.pathPattern),
              ref.method === null ? isNull(proxyRules.method) : eq(proxyRules.method, ref.method),
            ),
          );
      }
    });

    const changed =
      setCreated ||
      plan.toCreate.length > 0 ||
      plan.toUpdate.length > 0 ||
      plan.toDelete.length > 0;

    if (changed) {
      // Post-commit: a synced set may be attached to live aliases. Failure is a
      // warning, not a 500 — the DB state is committed; regeneration happens on
      // the next config change or restart.
      try {
        await this.nginxRegenerationService.regenerateForRuleSet(ruleSetId);
      } catch (error) {
        const message = `nginx regeneration failed after sync: ${(error as Error).message}. Rule changes are saved; regeneration will run on the next configuration change or restart.`;
        warnings.push(message);
        this.logger.warn(`Rule set ${ruleSetId}: ${message}`);
      }
    }

    this.logger.log(
      `Synced proxy rule set "${name}" (${ruleSetId}) for project ${projectId}: ` +
        `${plan.toCreate.length} created, ${plan.toUpdate.length} updated, ` +
        `${plan.toDelete.length} deleted, ${plan.unchanged.length} unchanged` +
        (setCreated ? ' (set created)' : ''),
    );

    // Post-commit, best-effort: snapshot the post-sync state. The hash-dedupe
    // in capture() means this is a no-op insert when nothing about the rule
    // set's name/description/environment/rules actually changed.
    if (postSyncRuleSet) {
      try {
        const currentRules = await this.proxyRulesService.getRulesByRuleSetId(ruleSetId);
        await this.captureRevisionSafely({
          ruleSet: postSyncRuleSet,
          rules: currentRules,
          trigger: captureTrigger ?? 'sync',
          userId,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to reload rules for sync revision capture on rule set ${ruleSetId}: ${(error as Error).message}`,
        );
      }
    }

    return buildResponse(ruleSetId);
  }

  /**
   * Insert/update column values for a plan-normalized rule (defaults already
   * applied by computeSyncPlan). `headerConfig` is passed separately — updates
   * substitute preserved live values first — and is encrypted here via
   * ProxyRulesService.encryptHeaderConfigForStorage (write-side counterpart of
   * the decrypted read). Never mutates `rule`.
   */
  private syncRuleToRowValues(
    rule: NormalizedSyncRule,
    headerConfig: ProxyHeaderConfig | null,
  ): Omit<typeof proxyRules.$inferInsert, 'id' | 'ruleSetId' | 'createdAt' | 'updatedAt'> {
    return {
      pathPattern: rule.pathPattern,
      method: rule.method,
      methods: rule.methods,
      targetUrl: rule.targetUrl,
      stripPrefix: rule.stripPrefix,
      order: rule.order,
      timeout: rule.timeout,
      preserveHost: rule.preserveHost,
      forwardCookies: rule.forwardCookies,
      headerConfig: this.proxyRulesService.encryptHeaderConfigForStorage(headerConfig),
      authTransform: rule.authTransform,
      internalRewrite: rule.internalRewrite,
      proxyType: rule.proxyType,
      emailHandlerConfig: rule.emailHandlerConfig,
      pipelineConfig: rule.pipelineConfig,
      isEnabled: rule.isEnabled,
      debugEnabled: rule.debugEnabled,
      description: rule.description,
    };
  }

  /**
   * Blank-secret preservation (decision 1): build a FRESH headerConfig whose
   * empty-string `add` values are replaced by the live decrypted value for the
   * same header name, when one exists. Non-empty incoming values win; a blank
   * with no live counterpart stays blank. The incoming object (which may alias
   * the request DTO) is never mutated.
   */
  private preserveBlankHeaderValues(
    incoming: ProxyHeaderConfig | null,
    live: ProxyHeaderConfig | null | undefined,
  ): ProxyHeaderConfig | null {
    if (!incoming) return null;
    if (!incoming.add) return { ...incoming };
    const add: Record<string, string> = {};
    for (const [header, value] of Object.entries(incoming.add)) {
      const liveValue = live?.add?.[header];
      add[header] =
        value === '' && typeof liveValue === 'string' && liveValue !== '' ? liveValue : value;
    }
    return { ...incoming, add };
  }

  /**
   * `missingSecrets[]` (warning-level, never fatal):
   * (a) every `{{secrets.NAME}}` reference in the (schema-remapped) incoming
   *     rules whose name has no `project_secrets` row for this project, and
   * (b) for NEW rules only (plan.toCreate), header `add` names whose incoming
   *     value is `''` — decision 1: there is nothing live to preserve, so the
   *     blank is stored and the operator is told to fill it in.
   * Deduplicated and sorted. The secrets table is only queried when (a) found
   * at least one reference.
   */
  private async collectMissingSecrets(
    projectId: string,
    incomingRules: SyncRuleInput[],
    plan: SyncPlan,
    liveRules: LiveSyncRule[],
  ): Promise<string[]> {
    const referenced = new Set<string>();
    for (const match of JSON.stringify(incomingRules).matchAll(SECRET_REF_PATTERN)) {
      referenced.add(match[1]);
    }

    const missing = new Set<string>();
    if (referenced.size > 0) {
      const rows = await db
        .select({ name: projectSecrets.name })
        .from(projectSecrets)
        .where(eq(projectSecrets.projectId, projectId))
        .orderBy(projectSecrets.name);
      const existingNames = new Set(rows.map((row) => row.name));
      for (const secretName of referenced) {
        if (!existingNames.has(secretName)) missing.add(secretName);
      }
    }

    // Blank header add values that will be stored as '' (decision 1): every
    // blank on a NEW rule, and — on updated rules — blanks whose header name
    // has no non-empty live value to preserve.
    for (const entry of plan.toCreate) {
      const add = entry.rule.headerConfig?.add;
      if (!add) continue;
      for (const [header, value] of Object.entries(add)) {
        if (value === '') missing.add(header);
      }
    }
    const liveAddByKey = new Map<string, Record<string, string>>();
    for (const live of liveRules) {
      const add = live.headerConfig?.add;
      if (add) {
        liveAddByKey.set(JSON.stringify([live.pathPattern, live.method ?? null]), add);
      }
    }
    for (const entry of plan.toUpdate) {
      const add = entry.rule.headerConfig?.add;
      if (!add) continue;
      const liveAdd = liveAddByKey.get(JSON.stringify([entry.pathPattern, entry.method]));
      for (const [header, value] of Object.entries(add)) {
        if (value === '' && !liveAdd?.[header]) missing.add(header);
      }
    }

    return [...missing].sort();
  }

  /**
   * `source.contentHash` — exact recipe (pinned by the Phase 1 plan doc,
   * cross-cutting definitions):
   *
   *   sha256 hex over `JSON.stringify({ ruleSet, rules })` where
   *   - `ruleSet` = `{ name, description?, environment? }` in that key order,
   *     null/undefined values stripped;
   *   - `rules` = the defaults-normalized incoming rules
   *     ({@link normalizeSyncRules} — same normalization the sync plan
   *     compares with, including proxyType/targetUrl inference), each
   *     serialized through {@link serializeRuleForExport} (canonical
   *     RULE_KEY_ORDER, null keys dropped, header `add` values blanked — so
   *     secrets are excluded by construction), sorted by
   *     `(order, pathPattern, method)` ({@link canonicalRuleCompare}).
   *
   * Schemas are excluded (project-level, not part of the set's content).
   * Computed server-side on every sync, stored in `source.contentHash`.
   *
   * Reproducibility caveat: the hash covers REMAPPED schema ids inside
   * pipelineConfig, so it is stable within one target project but not
   * reproducible from the git payload alone across projects. Phase 1 drift
   * detection uses `exportsEquivalent` (rules diff), not this hash.
   */
  private computeSyncContentHash(
    meta: { name: string; description?: string | null; environment?: string | null },
    incomingRules: SyncRuleInput[],
  ): string {
    const ruleSet: Record<string, string> = { name: meta.name };
    if (meta.description !== undefined && meta.description !== null) {
      ruleSet.description = meta.description;
    }
    if (meta.environment !== undefined && meta.environment !== null) {
      ruleSet.environment = meta.environment;
    }

    const rules = normalizeSyncRules(incomingRules)
      .map((rule) => serializeRuleForExport(rule))
      .sort(canonicalRuleCompare);

    return crypto.createHash('sha256').update(JSON.stringify({ ruleSet, rules })).digest('hex');
  }

  /**
   * Project plan refs to response DTOs, sorted by `(pathPattern, method ?? '')`
   * with plain code-unit comparison (locale-independent → byte-stable for CI).
   */
  private sortRuleRefs(refs: SyncRuleRef[]): SyncRuleRefDto[] {
    return refs
      .map(({ pathPattern, method }) => ({ pathPattern, method }))
      .sort((a, b) => {
        if (a.pathPattern !== b.pathPattern) return a.pathPattern < b.pathPattern ? -1 : 1;
        const ma = a.method ?? '';
        const mb = b.method ?? '';
        return ma === mb ? 0 : ma < mb ? -1 : 1;
      });
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
      .select({
        id: deploymentAliases.id,
        projectId: deploymentAliases.projectId,
        alias: deploymentAliases.alias,
      })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.proxyRuleSetId, id));

    // Collect unique alias info for nginx regeneration
    const aliasIdsFromJoin = affectedJoinRows.map((r) => r.aliasId);
    const affectedAliases: { projectId: string; alias: string }[] = [...affectedLegacyAliases];

    if (aliasIdsFromJoin.length > 0) {
      const joinAliases = await db
        .select({ projectId: deploymentAliases.projectId, alias: deploymentAliases.alias })
        .from(deploymentAliases)
        .where(inArray(deploymentAliases.id, aliasIdsFromJoin));
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

    this.logger.log(
      `Deleted proxy rule set ${id}, regenerated nginx for ${uniqueAliases.length} aliases`,
    );
  }

  // ==================== Helper Methods ====================

  /**
   * Best-effort revision capture for a mutation call site. `capture()` never
   * throws on its own, but this wraps the call anyway (mirroring the
   * post-commit nginx-regeneration pattern below) so a future change to the
   * revisions service — or an unexpected error constructing `input` — can
   * never turn a successful mutation into a failed request.
   */
  private async captureRevisionSafely(input: {
    ruleSet: ProxyRuleSet;
    rules: ProxyRule[];
    trigger: RevisionTrigger;
    userId?: string;
  }): Promise<void> {
    try {
      await this.proxyRuleSetRevisionsService.capture(input);
    } catch (error) {
      this.logger.warn(
        `Failed to capture ${input.trigger} revision for rule set ${input.ruleSet.id}: ${(error as Error).message}`,
      );
    }
  }

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
