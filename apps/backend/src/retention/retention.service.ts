import { Injectable, Inject, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { eq, and, desc, sql, lte, inArray } from 'drizzle-orm';
import picomatch from 'picomatch';
import { db } from '../db/client';
import {
  retentionRules,
  retentionLogs,
  assets,
  deploymentAliases,
  projects,
  RetentionRule,
  NewRetentionRule,
} from '../db/schema';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import { PermissionsService } from '../permissions/permissions.service';
import { UsageReporterService } from '../platform/usage-reporter.service';
import {
  CreateRetentionRuleDto,
  UpdateRetentionRuleDto,
  RetentionRuleResponseDto,
  PreviewDeletionResponseDto,
  PreviewCommitDto,
  RetentionLogResponseDto,
  ListRetentionLogsQueryDto,
  StorageOverviewDto,
} from './retention.dto';

interface CommitInfo {
  sha: string;
  branch: string | null;
  createdAt: Date;
  assetCount: number;
  sizeBytes: number;
  // For partial deletion
  isPartial: boolean;
  totalAssetCount?: number;
  totalSizeBytes?: number;
  // Asset IDs to delete (for partial deletion)
  assetIds?: string[];
}

/** Internal result type for rule execution */
interface ExecutionResult {
  deletedCommits: number;
  partialCommits: number;
  deletedAssets: number;
  freedBytes: number;
  errors?: string[];
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly permissionsService: PermissionsService,
    private readonly usageReporter: UsageReporterService,
  ) {}

  /**
   * Check if user has admin access to project
   */
  private async checkProjectAdminAccess(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<void> {
    // System admin has access to all
    if (userRole === 'admin') {
      return;
    }

    const role = await this.permissionsService.getUserProjectRole(userId, projectId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Only admin or owner can manage retention rules
    const roleHierarchy = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
    const userLevel = roleHierarchy[role] || 0;
    if (userLevel < 3) {
      throw new ForbiddenException('Managing retention rules requires admin role or higher');
    }
  }

  /**
   * Create a new retention rule
   */
  async createRule(
    projectId: string,
    dto: CreateRetentionRuleDto,
    userId: string,
    userRole?: string,
  ): Promise<RetentionRuleResponseDto> {
    await this.checkProjectAdminAccess(projectId, userId, userRole);

    // Calculate next run time (tomorrow at 3 AM UTC)
    const nextRunAt = this.calculateNextRunTime();

    const [rule] = await db
      .insert(retentionRules)
      .values({
        projectId,
        name: dto.name,
        branchPattern: dto.branchPattern,
        excludeBranches: dto.excludeBranches || [],
        retentionDays: dto.retentionDays,
        keepWithAlias: dto.keepWithAlias ?? true,
        keepMinimum: dto.keepMinimum ?? 0,
        enabled: dto.enabled ?? true,
        pathPatterns: dto.pathPatterns || null,
        pathMode: dto.pathMode || null,
        nextRunAt,
      })
      .returning();

    this.logger.log({
      event: 'retention_rule_created',
      ruleId: rule.id,
      projectId,
      name: dto.name,
      branchPattern: dto.branchPattern,
    });

    return this.toRuleResponse(rule);
  }

  /**
   * Update an existing retention rule
   */
  async updateRule(
    ruleId: string,
    dto: UpdateRetentionRuleDto,
    userId: string,
    userRole?: string,
  ): Promise<RetentionRuleResponseDto> {
    const rule = await this.getRuleById(ruleId);
    await this.checkProjectAdminAccess(rule.projectId, userId, userRole);

    const updateData: Partial<NewRetentionRule> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.branchPattern !== undefined) updateData.branchPattern = dto.branchPattern;
    if (dto.excludeBranches !== undefined) updateData.excludeBranches = dto.excludeBranches;
    if (dto.retentionDays !== undefined) updateData.retentionDays = dto.retentionDays;
    if (dto.keepWithAlias !== undefined) updateData.keepWithAlias = dto.keepWithAlias;
    if (dto.keepMinimum !== undefined) updateData.keepMinimum = dto.keepMinimum;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
    if (dto.pathPatterns !== undefined) updateData.pathPatterns = dto.pathPatterns;
    if (dto.pathMode !== undefined) updateData.pathMode = dto.pathMode;

    const [updated] = await db
      .update(retentionRules)
      .set(updateData)
      .where(eq(retentionRules.id, ruleId))
      .returning();

    this.logger.log({
      event: 'retention_rule_updated',
      ruleId,
      changes: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
    });

    return this.toRuleResponse(updated);
  }

  /**
   * Delete a retention rule
   */
  async deleteRule(ruleId: string, userId: string, userRole?: string): Promise<void> {
    const rule = await this.getRuleById(ruleId);
    await this.checkProjectAdminAccess(rule.projectId, userId, userRole);

    await db.delete(retentionRules).where(eq(retentionRules.id, ruleId));

    this.logger.log({
      event: 'retention_rule_deleted',
      ruleId,
      projectId: rule.projectId,
      name: rule.name,
    });
  }

  /**
   * List all retention rules for a project
   */
  async listRules(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<RetentionRuleResponseDto[]> {
    // Viewer access is sufficient to list rules
    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, projectId);
      if (!role) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    const rules = await db
      .select()
      .from(retentionRules)
      .where(eq(retentionRules.projectId, projectId))
      .orderBy(desc(retentionRules.createdAt));

    return rules.map((r) => this.toRuleResponse(r));
  }

  /**
   * Get a single rule by ID
   */
  async getRule(
    ruleId: string,
    userId: string,
    userRole?: string,
  ): Promise<RetentionRuleResponseDto> {
    const rule = await this.getRuleById(ruleId);

    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, rule.projectId);
      if (!role) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    return this.toRuleResponse(rule);
  }

  /**
   * Preview what commits would be deleted by a rule
   */
  async previewDeletion(
    ruleId: string,
    userId: string,
    userRole?: string,
  ): Promise<PreviewDeletionResponseDto> {
    const rule = await this.getRuleById(ruleId);

    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, rule.projectId);
      if (!role) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    const eligibleCommits = await this.findEligibleCommits(rule);

    const commits: PreviewCommitDto[] = eligibleCommits.map((c) => ({
      sha: c.sha,
      branch: c.branch || 'unknown',
      ageDays: this.daysSince(c.createdAt),
      assetCount: c.assetCount,
      sizeBytes: c.sizeBytes,
      createdAt: c.createdAt,
      isPartial: c.isPartial,
      totalAssetCount: c.totalAssetCount,
      totalSizeBytes: c.totalSizeBytes,
    }));

    const totalAssets = commits.reduce((sum, c) => sum + c.assetCount, 0);
    const totalBytes = commits.reduce((sum, c) => sum + c.sizeBytes, 0);

    return { commits, totalAssets, totalBytes };
  }

  /**
   * Execute a retention rule manually (async - fire and forget)
   * Returns immediately after starting the execution
   */
  async executeRule(
    ruleId: string,
    userId: string,
    userRole?: string,
  ): Promise<{ started: boolean; message: string }> {
    const rule = await this.getRuleById(ruleId);
    await this.checkProjectAdminAccess(rule.projectId, userId, userRole);

    // Check if already executing
    if (rule.executionStartedAt) {
      const startedAgo = Date.now() - new Date(rule.executionStartedAt).getTime();
      const minutesAgo = Math.floor(startedAgo / 60000);
      return {
        started: false,
        message: `Execution already in progress (started ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago)`,
      };
    }

    // Mark as executing
    await db
      .update(retentionRules)
      .set({ executionStartedAt: new Date() })
      .where(eq(retentionRules.id, ruleId));

    // Fire and forget - run in background
    setImmediate(async () => {
      try {
        await this.executeRuleInternal(rule);
      } catch (error) {
        this.logger.error({
          event: 'retention_rule_execution_error',
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Clear execution flag
        await db
          .update(retentionRules)
          .set({ executionStartedAt: null })
          .where(eq(retentionRules.id, ruleId));
      }
    });

    return { started: true, message: 'Execution started' };
  }

  /**
   * Execute a rule (internal, used by scheduler and background jobs)
   */
  async executeRuleInternal(rule: RetentionRule): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.logger.log({
      event: 'retention_rule_execution_started',
      ruleId: rule.id,
      projectId: rule.projectId,
      name: rule.name,
    });

    const eligibleCommits = await this.findEligibleCommits(rule);

    let deletedCommits = 0;
    let partialCommits = 0;
    let deletedAssets = 0;
    let freedBytes = 0;
    const errors: string[] = [];

    // Get project info for storage key prefix
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, rule.projectId))
      .limit(1);

    if (!project) {
      errors.push('Project not found');
      return { deletedCommits, partialCommits, deletedAssets, freedBytes, errors };
    }

    const repoPrefix = `${project.owner}/${project.name}`;

    for (const commit of eligibleCommits) {
      try {
        const result = await this.deleteCommitOrAssets(
          rule.projectId,
          commit.sha,
          commit.branch,
          rule.id,
          repoPrefix,
          commit.isPartial,
          commit.assetIds,
        );
        if (commit.isPartial) {
          partialCommits++;
        } else {
          deletedCommits++;
        }
        deletedAssets += result.assetCount;
        freedBytes += result.freedBytes;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : `Failed to delete commit ${commit.sha}`;
        errors.push(errorMsg);
        this.logger.error({
          event: 'retention_commit_deletion_failed',
          ruleId: rule.id,
          commitSha: commit.sha,
          error: errorMsg,
        });
      }
    }

    // Update rule with execution results
    const nextRunAt = this.calculateNextRunTime();
    await db
      .update(retentionRules)
      .set({
        lastRunAt: new Date(),
        nextRunAt,
        lastRunSummary: {
          deletedCommits,
          partialCommits,
          deletedAssets,
          freedBytes,
          errors: errors.length > 0 ? errors : undefined,
        },
        updatedAt: new Date(),
      })
      .where(eq(retentionRules.id, rule.id));

    const duration = Date.now() - startTime;
    this.logger.log({
      event: 'retention_rule_execution_completed',
      ruleId: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      deletedCommits,
      partialCommits,
      deletedAssets,
      freedBytes,
      errorCount: errors.length,
      durationMs: duration,
    });

    // Report usage to Control Plane (fire-and-forget)
    if (freedBytes > 0) {
      this.usageReporter.reportDelete(freedBytes).catch(() => {});
    }

    return {
      deletedCommits,
      partialCommits,
      deletedAssets,
      freedBytes,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Find commits eligible for deletion based on rule criteria
   */
  async findEligibleCommits(rule: RetentionRule): Promise<CommitInfo[]> {
    // 1. Get all distinct commits for project
    const commitData = await db
      .select({
        commitSha: assets.commitSha,
        branch: assets.branch,
        createdAt: sql<Date>`MIN(${assets.createdAt})`.as('created_at'),
        assetCount: sql<number>`COUNT(*)::int`.as('asset_count'),
        sizeBytes: sql<number>`SUM(${assets.size})::int`.as('size_bytes'),
      })
      .from(assets)
      .where(and(eq(assets.projectId, rule.projectId), sql`${assets.commitSha} IS NOT NULL`))
      .groupBy(assets.commitSha, assets.branch);

    if (commitData.length === 0) {
      return [];
    }

    // 2. Filter by branch pattern (using picomatch for glob matching)
    // Standard glob: * matches anything except /, ** matches everything including /
    const branchMatcher = picomatch(rule.branchPattern, { dot: true });
    const matchingPattern = commitData.filter((c) => {
      // Include commits without branch if pattern matches all
      if (!c.branch) {
        return rule.branchPattern === '**';
      }
      return branchMatcher(c.branch);
    });

    // 3. Exclude protected branches
    const excludeMatchers = (rule.excludeBranches || []).map((pattern) => picomatch(pattern));
    const notExcluded = matchingPattern.filter((c) => {
      if (!c.branch) return true;
      return !excludeMatchers.some((matcher) => matcher(c.branch!));
    });

    // 4. Filter by age (older than retentionDays)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rule.retentionDays);
    const oldEnough = notExcluded.filter((c) => new Date(c.createdAt) < cutoffDate);

    // 5. Exclude commits with active aliases (non-auto-preview)
    let filtered = oldEnough;
    if (rule.keepWithAlias) {
      const aliasedCommits = await this.getCommitsWithAliases(rule.projectId);
      const aliasSet = new Set(aliasedCommits);
      filtered = oldEnough.filter((c) => !aliasSet.has(c.commitSha!));
    }

    // 6. Keep minimum per branch
    if (rule.keepMinimum > 0) {
      filtered = this.applyKeepMinimum(filtered, rule.keepMinimum);
    }

    // 7. Handle path patterns for partial deletion
    const hasPathPatterns = rule.pathPatterns && rule.pathPatterns.length > 0 && rule.pathMode;

    if (!hasPathPatterns) {
      // Full commit deletion (original behavior)
      return filtered.map((c) => ({
        sha: c.commitSha!,
        branch: c.branch,
        createdAt: new Date(c.createdAt),
        assetCount: c.assetCount,
        sizeBytes: c.sizeBytes,
        isPartial: false,
      }));
    }

    // Partial deletion - need to get file-level info
    const pathPatterns = rule.pathPatterns as string[];
    const pathMode = rule.pathMode as 'include' | 'exclude';
    const pathMatchers = pathPatterns.map((p) => picomatch(p));

    const result: CommitInfo[] = [];

    for (const commit of filtered) {
      // Get all assets for this commit
      const commitAssets = await db
        .select({
          id: assets.id,
          publicPath: assets.publicPath,
          size: assets.size,
        })
        .from(assets)
        .where(and(eq(assets.projectId, rule.projectId), eq(assets.commitSha, commit.commitSha!)));

      // Filter assets by path pattern
      const assetsToDelete = commitAssets.filter((a) => {
        const path = a.publicPath || '';
        const matches = pathMatchers.some((matcher) => matcher(path));
        // exclude mode: delete matching files
        // include mode: delete non-matching files
        return pathMode === 'exclude' ? matches : !matches;
      });

      if (assetsToDelete.length === 0) {
        continue; // Nothing to delete for this commit
      }

      const isPartial = assetsToDelete.length < commitAssets.length;
      const deleteSize = assetsToDelete.reduce((sum, a) => sum + a.size, 0);

      result.push({
        sha: commit.commitSha!,
        branch: commit.branch,
        createdAt: new Date(commit.createdAt),
        assetCount: assetsToDelete.length,
        sizeBytes: deleteSize,
        isPartial,
        totalAssetCount: commitAssets.length,
        totalSizeBytes: commit.sizeBytes,
        assetIds: assetsToDelete.map((a) => a.id),
      });
    }

    return result;
  }

  /**
   * Get commit SHAs that have active non-auto-preview aliases
   */
  private async getCommitsWithAliases(projectId: string): Promise<string[]> {
    const aliases = await db
      .select({ commitSha: deploymentAliases.commitSha })
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.isAutoPreview, false)),
      );

    return aliases.map((a) => a.commitSha);
  }

  /**
   * Keep the N most recent commits per branch
   */
  private applyKeepMinimum(
    commits: Array<{
      commitSha: string | null;
      branch: string | null;
      createdAt: Date;
      assetCount: number;
      sizeBytes: number;
    }>,
    keepMinimum: number,
  ): typeof commits {
    // Group by branch
    const byBranch = new Map<string, typeof commits>();
    for (const commit of commits) {
      const branch = commit.branch || '__no_branch__';
      if (!byBranch.has(branch)) {
        byBranch.set(branch, []);
      }
      byBranch.get(branch)!.push(commit);
    }

    // For each branch, sort by date and remove the N most recent from deletion list
    const result: typeof commits = [];
    for (const [, branchCommits] of byBranch) {
      // Sort oldest first
      branchCommits.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // Skip the last N (most recent) commits
      if (branchCommits.length > keepMinimum) {
        result.push(...branchCommits.slice(0, branchCommits.length - keepMinimum));
      }
      // If we have fewer than keepMinimum, don't delete any from this branch
    }

    return result;
  }

  /**
   * Delete a commit (full) or specific assets (partial)
   */
  private async deleteCommitOrAssets(
    projectId: string,
    commitSha: string,
    branch: string | null,
    ruleId: string,
    repoPrefix: string,
    isPartial: boolean,
    assetIds?: string[],
  ): Promise<{ assetCount: number; freedBytes: number }> {
    if (isPartial && assetIds && assetIds.length > 0) {
      // Partial deletion - delete specific assets
      return this.deleteSpecificAssets(projectId, commitSha, branch, ruleId, assetIds);
    }

    // Full commit deletion
    return this.deleteFullCommit(projectId, commitSha, branch, ruleId, repoPrefix);
  }

  /**
   * Delete all assets for a commit (full deletion)
   */
  private async deleteFullCommit(
    projectId: string,
    commitSha: string,
    branch: string | null,
    ruleId: string,
    repoPrefix: string,
  ): Promise<{ assetCount: number; freedBytes: number }> {
    // Get all assets for this commit
    const commitAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, projectId), eq(assets.commitSha, commitSha)));

    if (commitAssets.length === 0) {
      return { assetCount: 0, freedBytes: 0 };
    }

    const assetCount = commitAssets.length;
    const freedBytes = commitAssets.reduce((sum, a) => sum + a.size, 0);

    // Delete from storage (use prefix delete for efficiency)
    const storagePrefix = `${repoPrefix}/commits/${commitSha}/`;
    try {
      await this.storageAdapter.deletePrefix(storagePrefix);
    } catch (error) {
      this.logger.warn({
        event: 'retention_storage_cleanup_warning',
        commitSha,
        storagePrefix,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with database cleanup even if storage fails
    }

    // Delete auto-preview aliases for this commit
    await db
      .delete(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, projectId),
          eq(deploymentAliases.commitSha, commitSha),
          eq(deploymentAliases.isAutoPreview, true),
        ),
      );

    // Delete asset records
    await db
      .delete(assets)
      .where(and(eq(assets.projectId, projectId), eq(assets.commitSha, commitSha)));

    // Log deletion for audit
    await db.insert(retentionLogs).values({
      projectId,
      ruleId,
      commitSha,
      branch,
      assetCount,
      freedBytes,
      isPartial: false,
    });

    return { assetCount, freedBytes };
  }

  /**
   * Delete specific assets from a commit (partial deletion)
   */
  private async deleteSpecificAssets(
    projectId: string,
    commitSha: string,
    branch: string | null,
    ruleId: string,
    assetIds: string[],
  ): Promise<{ assetCount: number; freedBytes: number }> {
    // Get asset details for storage deletion
    const assetsToDelete = await db
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, projectId), inArray(assets.id, assetIds)));

    if (assetsToDelete.length === 0) {
      return { assetCount: 0, freedBytes: 0 };
    }

    const assetCount = assetsToDelete.length;
    const freedBytes = assetsToDelete.reduce((sum, a) => sum + a.size, 0);

    // Delete each file from storage individually
    for (const asset of assetsToDelete) {
      try {
        await this.storageAdapter.delete(asset.storageKey);
      } catch (error) {
        this.logger.warn({
          event: 'retention_storage_file_cleanup_warning',
          commitSha,
          storageKey: asset.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other files even if one fails
      }
    }

    // Delete asset records
    await db.delete(assets).where(inArray(assets.id, assetIds));

    // Log deletion for audit
    await db.insert(retentionLogs).values({
      projectId,
      ruleId,
      commitSha,
      branch,
      assetCount,
      freedBytes,
      isPartial: true,
    });

    return { assetCount, freedBytes };
  }

  /**
   * Get retention logs for a project
   */
  async getRetentionLogs(
    projectId: string,
    query: ListRetentionLogsQueryDto,
    userId: string,
    userRole?: string,
  ): Promise<{ data: RetentionLogResponseDto[]; total: number }> {
    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, projectId);
      if (!role) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const conditions = [eq(retentionLogs.projectId, projectId)];
    if (query.ruleId) {
      conditions.push(eq(retentionLogs.ruleId, query.ruleId));
    }

    const whereClause = and(...conditions);

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(retentionLogs)
      .where(whereClause);

    const total = countResult?.count || 0;

    // Get paginated results
    const logs = await db
      .select()
      .from(retentionLogs)
      .where(whereClause)
      .orderBy(desc(retentionLogs.deletedAt))
      .limit(limit)
      .offset(offset);

    const data: RetentionLogResponseDto[] = logs.map((log) => ({
      id: log.id,
      projectId: log.projectId,
      ruleId: log.ruleId || undefined,
      commitSha: log.commitSha,
      branch: log.branch || undefined,
      assetCount: log.assetCount,
      freedBytes: Number(log.freedBytes),
      isPartial: log.isPartial,
      deletedAt: log.deletedAt,
    }));

    return { data, total };
  }

  /**
   * Get storage overview for a project
   */
  async getStorageOverview(
    projectId: string,
    userId: string,
    userRole?: string,
  ): Promise<StorageOverviewDto> {
    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, projectId);
      if (!role) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    // Get aggregate stats
    const [stats] = await db
      .select({
        totalBytes: sql<number>`COALESCE(SUM(${assets.size}), 0)::bigint`.as('total_bytes'),
        commitCount: sql<number>`COUNT(DISTINCT ${assets.commitSha})::int`.as('commit_count'),
        branchCount: sql<number>`COUNT(DISTINCT ${assets.branch})::int`.as('branch_count'),
      })
      .from(assets)
      .where(eq(assets.projectId, projectId));

    // Get oldest commit
    const [oldest] = await db
      .select({
        createdAt: assets.createdAt,
        branch: assets.branch,
      })
      .from(assets)
      .where(and(eq(assets.projectId, projectId), sql`${assets.commitSha} IS NOT NULL`))
      .orderBy(assets.createdAt)
      .limit(1);

    return {
      totalBytes: Number(stats?.totalBytes || 0),
      commitCount: stats?.commitCount || 0,
      branchCount: stats?.branchCount || 0,
      oldestCommitAt: oldest?.createdAt,
      oldestCommitBranch: oldest?.branch || undefined,
    };
  }

  /**
   * Find rules due for scheduled execution
   */
  async findDueRules(): Promise<RetentionRule[]> {
    return db
      .select()
      .from(retentionRules)
      .where(and(eq(retentionRules.enabled, true), lte(retentionRules.nextRunAt, new Date())));
  }

  // Helper methods

  private async getRuleById(ruleId: string): Promise<RetentionRule> {
    const [rule] = await db
      .select()
      .from(retentionRules)
      .where(eq(retentionRules.id, ruleId))
      .limit(1);

    if (!rule) {
      throw new NotFoundException(`Retention rule not found: ${ruleId}`);
    }

    return rule;
  }

  private toRuleResponse(rule: RetentionRule): RetentionRuleResponseDto {
    return {
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      branchPattern: rule.branchPattern,
      excludeBranches: (rule.excludeBranches as string[]) || [],
      retentionDays: rule.retentionDays,
      keepWithAlias: rule.keepWithAlias,
      keepMinimum: rule.keepMinimum,
      enabled: rule.enabled,
      pathPatterns: (rule.pathPatterns as string[]) || undefined,
      pathMode: rule.pathMode || undefined,
      lastRunAt: rule.lastRunAt || undefined,
      nextRunAt: rule.nextRunAt || undefined,
      executionStartedAt: rule.executionStartedAt || undefined,
      lastRunSummary: rule.lastRunSummary || undefined,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  private calculateNextRunTime(): Date {
    // Schedule for 3 AM UTC tomorrow
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(3, 0, 0, 0);
    return next;
  }

  private daysSince(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
