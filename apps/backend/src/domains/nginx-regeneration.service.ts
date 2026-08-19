import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { db } from '../db/client';
import {
  domainMappings,
  deploymentAliases,
  projects,
  pathRedirects,
  aliasProxyRuleSets,
  projectDefaultProxyRuleSets,
} from '../db/schema';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { NginxConfigService, NginxProxyRule, NginxPathRedirect } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';

/**
 * Service for regenerating nginx configs when proxy rules or alias assignments change.
 *
 * This service is called from:
 * - ProxyRulesService: after create/update/delete/reorder operations
 * - DeploymentsService: when alias proxyRuleSetId changes
 *
 * It finds all affected domain mappings and regenerates their nginx configs.
 */
@Injectable()
export class NginxRegenerationService {
  private readonly logger = new Logger(NginxRegenerationService.name);

  constructor(
    private readonly nginxConfigService: NginxConfigService,
    private readonly nginxReloadService: NginxReloadService,
    private readonly projectsService: ProjectsService,
    @Inject(forwardRef(() => ProxyRulesService))
    private readonly proxyRulesService: ProxyRulesService,
  ) {}

  /**
   * Regenerate nginx configs for all domains affected by a proxy rule set change.
   * Called when proxy rules in a rule set are created, updated, deleted, or reordered.
   *
   * @throws Error if any nginx regeneration fails (caller should handle rollback)
   */
  async regenerateForRuleSet(ruleSetId: string): Promise<void> {
    this.logger.log(`Regenerating nginx configs for rule set ${ruleSetId}`);

    // Find aliases using this rule set via join table
    const joinRows = await db
      .select({ aliasId: aliasProxyRuleSets.aliasId })
      .from(aliasProxyRuleSets)
      .where(eq(aliasProxyRuleSets.proxyRuleSetId, ruleSetId));

    // Also find aliases using the legacy column
    const legacyAliases = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.proxyRuleSetId, ruleSetId));

    // Resolve join table alias IDs to full alias records
    const joinAliasIds = joinRows.map((r) => r.aliasId);
    let joinAliases: (typeof deploymentAliases.$inferSelect)[] = [];
    if (joinAliasIds.length > 0) {
      joinAliases = await db
        .select()
        .from(deploymentAliases)
        .where(inArray(deploymentAliases.id, joinAliasIds));
    }

    // Deduplicate by ID
    const allAliasMap = new Map<string, typeof deploymentAliases.$inferSelect>();
    for (const alias of [...legacyAliases, ...joinAliases]) {
      allAliasMap.set(alias.id, alias);
    }
    const allAliases = Array.from(allAliasMap.values());

    if (allAliases.length === 0) {
      this.logger.debug(`No aliases using rule set ${ruleSetId}, skipping regeneration`);
      return;
    }

    // Regenerate nginx config for each alias
    for (const alias of allAliases) {
      await this.regenerateForAlias(alias.projectId, alias.alias);
    }

    this.logger.log(
      `Regenerated nginx configs for ${allAliases.length} aliases using rule set ${ruleSetId}`,
    );
  }

  /**
   * Regenerate nginx config for a specific project/alias combination.
   * Called when an alias's proxyRuleSetId changes.
   *
   * @throws Error if nginx regeneration fails (caller should handle rollback)
   */
  async regenerateForAlias(projectId: string, aliasName: string): Promise<void> {
    this.logger.log(`Regenerating nginx configs for alias ${aliasName} in project ${projectId}`);

    // Find all active domain mappings for this alias
    const domains = await db
      .select()
      .from(domainMappings)
      .where(
        and(
          eq(domainMappings.projectId, projectId),
          eq(domainMappings.alias, aliasName),
          eq(domainMappings.isActive, true),
        ),
      );

    if (domains.length === 0) {
      this.logger.debug(
        `No active domain mappings for alias ${aliasName} in project ${projectId}, skipping`,
      );
      return;
    }

    // Regenerate each domain's nginx config
    for (const domain of domains) {
      await this.regenerateDomainConfig(domain);
    }

    this.logger.log(`Regenerated ${domains.length} domain configs for alias ${aliasName}`);
  }

  /**
   * Regenerate nginx config for a domain mapping by ID.
   * Called when path redirects or other domain-specific settings change.
   *
   * @throws Error if domain not found or nginx regeneration fails
   */
  async regenerateForDomain(domainMappingId: string): Promise<void> {
    this.logger.log(`Regenerating nginx config for domain mapping ${domainMappingId}`);

    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainMappingId))
      .limit(1);

    if (!domain) {
      throw new Error(`Domain mapping ${domainMappingId} not found`);
    }

    await this.regenerateDomainConfig(domain);
  }

  /**
   * Regenerate nginx config for a single domain mapping.
   */
  private async regenerateDomainConfig(domain: typeof domainMappings.$inferSelect): Promise<void> {
    // For redirect domains, projectId may be null - use empty project
    const project = domain.projectId
      ? await this.projectsService.getProjectById(domain.projectId)
      : { owner: '', name: '' };

    // Get nginx proxy rules with authTransform for this domain
    const proxyRules = domain.projectId
      ? await this.getNginxProxyRulesForDomain(domain.projectId, domain.alias)
      : [];

    // Get path redirects for this domain
    const domainPathRedirects = await this.getPathRedirectsForDomain(domain.id);

    // Generate the new config
    const config = await this.nginxConfigService.generateConfig(
      domain,
      project,
      proxyRules,
      domainPathRedirects,
    );

    // Write and reload
    const { tempPath, finalPath } = await this.nginxConfigService.writeConfigFile(
      domain.id,
      config,
    );

    const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);

    if (!result.success) {
      throw new Error(`Failed to reload nginx config for ${domain.domain}: ${result.error}`);
    }

    this.logger.debug(`Regenerated nginx config for ${domain.domain}`);
  }

  /**
   * Get active path redirects for a domain mapping.
   * Returns redirects sorted by priority for nginx config generation.
   */
  private async getPathRedirectsForDomain(domainMappingId: string): Promise<NginxPathRedirect[]> {
    const redirects = await db
      .select()
      .from(pathRedirects)
      .where(
        and(eq(pathRedirects.domainMappingId, domainMappingId), eq(pathRedirects.isActive, true)),
      )
      .orderBy(pathRedirects.priority);

    return redirects.map((r) => ({
      sourcePath: r.sourcePath,
      targetPath: r.targetPath,
      redirectType: r.redirectType as '301' | '302',
      priority: r.priority,
    }));
  }

  /**
   * Get nginx proxy rules for a domain mapping.
   * Returns rules with authTransform set, which will be rendered as nginx location blocks.
   *
   * Resolution order (mirrors NginxStartupService.getNginxProxyRulesForDomain):
   *   1. Alias's own rule sets (join table → legacy column)
   *   2. Auto-preview aliases inherit from manual aliases at same commit (join table → legacy column)
   *   3. Project default (join table → legacy column)
   *   4. Else -> no proxy rules
   */
  private async getNginxProxyRulesForDomain(
    projectId: string,
    aliasName: string | null,
  ): Promise<NginxProxyRule[]> {
    if (!aliasName) {
      return [];
    }

    try {
      const alias = await db
        .select()
        .from(deploymentAliases)
        .where(
          and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
        )
        .limit(1);

      if (alias.length === 0) {
        return [];
      }

      let ruleSetIds: string[] = [];

      const joinRows = await db
        .select({ proxyRuleSetId: aliasProxyRuleSets.proxyRuleSetId })
        .from(aliasProxyRuleSets)
        .where(eq(aliasProxyRuleSets.aliasId, alias[0].id))
        .orderBy(asc(aliasProxyRuleSets.order));

      if (joinRows.length > 0) {
        ruleSetIds = joinRows.map((r) => r.proxyRuleSetId);
      } else if (alias[0].proxyRuleSetId) {
        ruleSetIds = [alias[0].proxyRuleSetId];
      }

      if (ruleSetIds.length === 0 && alias[0].isAutoPreview) {
        const inheritedIds = await this.findProxyRuleSetsFromCommitAliases(
          projectId,
          alias[0].commitSha,
        );
        if (inheritedIds.length > 0) {
          ruleSetIds = inheritedIds;
        }
      }

      if (ruleSetIds.length === 0) {
        const projectDefaultJoinRows = await db
          .select({ proxyRuleSetId: projectDefaultProxyRuleSets.proxyRuleSetId })
          .from(projectDefaultProxyRuleSets)
          .where(eq(projectDefaultProxyRuleSets.projectId, projectId))
          .orderBy(asc(projectDefaultProxyRuleSets.order));

        if (projectDefaultJoinRows.length > 0) {
          ruleSetIds = projectDefaultJoinRows.map((r) => r.proxyRuleSetId);
        } else {
          const project = await db
            .select({ defaultProxyRuleSetId: projects.defaultProxyRuleSetId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

          if (project.length > 0 && project[0].defaultProxyRuleSetId) {
            ruleSetIds = [project[0].defaultProxyRuleSetId];
          }
        }
      }

      if (ruleSetIds.length === 0) {
        return [];
      }

      const rules = await this.proxyRulesService.getEffectiveRulesForMultipleRuleSets(ruleSetIds);

      return rules
        .filter((rule) => rule.authTransform !== null)
        .map((rule) => ({
          pathPattern: rule.pathPattern,
          targetUrl: rule.targetUrl,
          stripPrefix: rule.stripPrefix,
          timeout: Math.floor(rule.timeout / 1000),
          authTransform: rule.authTransform!,
          description: rule.description || undefined,
        }));
    } catch (error) {
      this.logger.warn(`Failed to get nginx proxy rules for domain: ${error}`);
      return [];
    }
  }

  /**
   * Find proxy rule set IDs from manual aliases that point to the same commit.
   * This allows auto-preview aliases to inherit proxy rules from manual aliases
   * (like "production" or "preview") that point to the same commit SHA.
   *
   * Reads the join table first (modern multi-rule-set attachment), then falls
   * back to the legacy single-id column. Returns ALL inherited rule set IDs.
   */
  private async findProxyRuleSetsFromCommitAliases(
    projectId: string,
    commitSha: string,
  ): Promise<string[]> {
    const manualAliases = await db
      .select({ id: deploymentAliases.id, proxyRuleSetId: deploymentAliases.proxyRuleSetId })
      .from(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, projectId),
          eq(deploymentAliases.commitSha, commitSha),
          eq(deploymentAliases.isAutoPreview, false),
        ),
      );

    for (const manual of manualAliases) {
      const joinRows = await db
        .select({ proxyRuleSetId: aliasProxyRuleSets.proxyRuleSetId })
        .from(aliasProxyRuleSets)
        .where(eq(aliasProxyRuleSets.aliasId, manual.id))
        .orderBy(asc(aliasProxyRuleSets.order));

      if (joinRows.length > 0) {
        return joinRows.map((r) => r.proxyRuleSetId);
      }
      if (manual.proxyRuleSetId) {
        return [manual.proxyRuleSetId];
      }
    }

    return [];
  }
}
