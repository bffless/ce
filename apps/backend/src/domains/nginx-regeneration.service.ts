import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { db } from '../db/client';
import { domainMappings, deploymentAliases, projects, pathRedirects } from '../db/schema';
import { eq, and } from 'drizzle-orm';
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

    // Find all aliases using this rule set
    const aliases = await db
      .select()
      .from(deploymentAliases)
      .where(eq(deploymentAliases.proxyRuleSetId, ruleSetId));

    if (aliases.length === 0) {
      this.logger.debug(`No aliases using rule set ${ruleSetId}, skipping regeneration`);
      return;
    }

    // Regenerate nginx config for each alias
    for (const alias of aliases) {
      await this.regenerateForAlias(alias.projectId, alias.alias);
    }

    this.logger.log(
      `Regenerated nginx configs for ${aliases.length} aliases using rule set ${ruleSetId}`,
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
   * This method mirrors the logic in NginxStartupService.getNginxProxyRulesForDomain()
   * to ensure consistent behavior between startup and on-demand regeneration.
   *
   * Resolution order:
   *   1. If alias has a proxyRuleSetId -> use that rule set
   *   2. For preview aliases, check manual aliases with same commitSha for proxyRuleSetId
   *   3. Else if project has a defaultProxyRuleSetId -> use that rule set
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
      // Find the alias
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

      // Get the rule set ID (alias override or inherited from commit aliases or project default)
      let ruleSetId = alias[0].proxyRuleSetId;

      // For preview aliases without a rule set, check manual aliases with same commit
      if (!ruleSetId && alias[0].isAutoPreview) {
        const commitAliasRuleSet = await this.findProxyRuleSetFromCommitAliases(
          projectId,
          alias[0].commitSha,
        );
        if (commitAliasRuleSet) {
          ruleSetId = commitAliasRuleSet;
        }
      }

      if (!ruleSetId) {
        // Try project default
        const project = await db
          .select({ defaultProxyRuleSetId: projects.defaultProxyRuleSetId })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (project.length > 0) {
          ruleSetId = project[0].defaultProxyRuleSetId;
        }
      }

      if (!ruleSetId) {
        return [];
      }

      // Get all enabled rules from the rule set
      const rules = await this.proxyRulesService.getEffectiveRulesForRuleSet(ruleSetId);

      // Filter for rules with authTransform set and map to NginxProxyRule interface
      return rules
        .filter((rule) => rule.authTransform !== null)
        .map((rule) => ({
          pathPattern: rule.pathPattern,
          targetUrl: rule.targetUrl,
          stripPrefix: rule.stripPrefix,
          timeout: Math.floor(rule.timeout / 1000), // Convert ms to seconds
          authTransform: rule.authTransform!,
          description: rule.description || undefined,
        }));
    } catch (error) {
      this.logger.warn(`Failed to get nginx proxy rules for domain: ${error}`);
      return [];
    }
  }

  /**
   * Find a proxy rule set ID from manual aliases that point to the same commit.
   * This allows preview aliases to inherit proxy rules from manual aliases
   * (like "production") that point to the same commit SHA.
   *
   * @returns The proxyRuleSetId from a manual alias with the same commit, or null
   */
  private async findProxyRuleSetFromCommitAliases(
    projectId: string,
    commitSha: string,
  ): Promise<string | null> {
    // Find manual aliases (non-preview) with the same commit that have proxy rules
    const [aliasWithRules] = await db
      .select({ proxyRuleSetId: deploymentAliases.proxyRuleSetId })
      .from(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, projectId),
          eq(deploymentAliases.commitSha, commitSha),
          eq(deploymentAliases.isAutoPreview, false),
        ),
      )
      .limit(1);

    return aliasWithRules?.proxyRuleSetId || null;
  }
}
