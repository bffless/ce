import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { db } from '../db/client';
import {
  domainMappings,
  domainRedirects,
  projects,
  deploymentAliases,
  pathRedirects,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NginxConfigService, NginxProxyRule, NginxPathRedirect } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { SslCertificateService } from './ssl-certificate.service';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';

/**
 * Service that regenerates all nginx configs on backend startup.
 * This ensures any template changes are applied automatically without
 * requiring manual domain remapping.
 */
@Injectable()
export class NginxStartupService implements OnModuleInit {
  private readonly logger = new Logger(NginxStartupService.name);

  constructor(
    private readonly nginxConfigService: NginxConfigService,
    private readonly nginxReloadService: NginxReloadService,
    private readonly projectsService: ProjectsService,
    private readonly sslCertificateService: SslCertificateService,
    private readonly proxyRulesService: ProxyRulesService,
  ) {}

  async onModuleInit() {
    // Skip in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Wait a bit for database connections to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      await this.regenerateAllConfigs();
    } catch (error) {
      this.logger.error(`Failed to regenerate nginx configs on startup: ${error}`);
      // Don't throw - the app should still start even if this fails
    }
  }

  /**
   * Regenerates all nginx configs (domain mappings + redirects + primary content)
   */
  async regenerateAllConfigs(): Promise<void> {
    this.logger.log('Regenerating all nginx configs on startup...');

    // 1. Regenerate all domain mapping configs
    await this.regenerateDomainMappingConfigs();

    // 2. Regenerate all redirect configs
    await this.regenerateRedirectConfigs();

    // 3. Regenerate primary content config
    await this.regeneratePrimaryContentConfig();

    this.logger.log('Nginx config regeneration complete');
  }

  /**
   * Get nginx proxy rules for a domain mapping.
   * Returns rules with authTransform set, which will be rendered as nginx location blocks.
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
        .where(and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)))
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

  /**
   * Regenerates nginx configs for all active domain mappings
   */
  private async regenerateDomainMappingConfigs(): Promise<void> {
    const domains = await db.select().from(domainMappings).where(eq(domainMappings.isActive, true));

    if (domains.length === 0) {
      this.logger.log('No active domain mappings found');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const domain of domains) {
      try {
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

        const config = await this.nginxConfigService.generateConfig(
          domain,
          project,
          proxyRules,
          domainPathRedirects,
        );
        const { tempPath, finalPath } = await this.nginxConfigService.writeConfigFile(
          domain.id,
          config,
        );
        await this.nginxReloadService.validateAndReload(tempPath, finalPath);
        successCount++;
      } catch (error) {
        this.logger.error(`Failed to regenerate config for ${domain.domain}: ${error}`);
        errorCount++;
      }
    }

    this.logger.log(`Regenerated ${successCount} domain mapping configs (${errorCount} errors)`);
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
   * Regenerates nginx configs for all active redirects
   */
  private async regenerateRedirectConfigs(): Promise<void> {
    const redirects = await db
      .select({
        redirect: domainRedirects,
        targetDomain: domainMappings.domain,
      })
      .from(domainRedirects)
      .innerJoin(domainMappings, eq(domainRedirects.targetDomainId, domainMappings.id))
      .where(eq(domainRedirects.isActive, true));

    if (redirects.length === 0) {
      this.logger.log('No active redirects found');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const { redirect, targetDomain } of redirects) {
      try {
        // If SSL is enabled, ensure the certificate/symlink exists
        let sslEnabled = redirect.sslEnabled;
        if (sslEnabled) {
          const sslResult = await this.sslCertificateService.ensureRedirectSslCert(
            redirect.sourceDomain,
            targetDomain,
          );
          if (!sslResult.success) {
            this.logger.warn(
              `SSL cert not available for redirect ${redirect.sourceDomain}, disabling SSL in config: ${sslResult.error}`,
            );
            sslEnabled = false;
          }
        }

        const config = await this.nginxConfigService.generateRedirectConfig({
          sourceDomain: redirect.sourceDomain,
          targetDomain,
          redirectType: redirect.redirectType as '301' | '302',
          sslEnabled,
          isActive: redirect.isActive,
        });

        const { tempPath, finalPath } = await this.nginxConfigService.writeRedirectConfigFile(
          redirect.id,
          config,
        );
        await this.nginxReloadService.validateAndReload(tempPath, finalPath);
        successCount++;
      } catch (error) {
        this.logger.error(
          `Failed to regenerate redirect config for ${redirect.sourceDomain}: ${error}`,
        );
        errorCount++;
      }
    }

    this.logger.log(`Regenerated ${successCount} redirect configs (${errorCount} errors)`);
  }

  /**
   * Regenerates the primary content nginx config (www/root domain).
   *
   * - If an ACTIVE primary domain mapping exists, it's already handled by regenerateDomainMappingConfigs()
   * - If an INACTIVE primary domain mapping exists, generate a welcome page
   * - If no primary domain mapping exists, generate a welcome page
   */
  private async regeneratePrimaryContentConfig(): Promise<void> {
    // Check if a primary domain mapping exists (unified system)
    const [primaryDomainMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.isPrimary, true))
      .limit(1);

    if (primaryDomainMapping && primaryDomainMapping.isActive) {
      // Active primary domain - already handled by regenerateDomainMappingConfigs()
      this.logger.log(
        'Active primary domain mapping exists - config already regenerated by domain mappings handler',
      );
      // Clean up legacy primary-content.conf if it exists (avoid conflict)
      await this.cleanupLegacyPrimaryContentConfig();
      return;
    }

    // Either no primary domain mapping, or it's inactive - generate welcome page config
    try {
      const { tempPath, finalPath } = await this.nginxConfigService.generateWelcomePageConfig();

      const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);

      if (result.success) {
        const reason = primaryDomainMapping
          ? 'primary domain disabled'
          : 'no primary domain configured';
        this.logger.log(`Regenerated welcome page config (${reason})`);
      } else {
        this.logger.error(`Failed to reload welcome page config: ${result.error}`);
      }
    } catch (error) {
      this.logger.error(`Failed to regenerate welcome page config: ${error}`);
    }
  }

  /**
   * Remove legacy primary-content.conf to avoid conflicts with domain mapping config
   */
  private async cleanupLegacyPrimaryContentConfig(): Promise<void> {
    try {
      const { unlink } = await import('fs/promises');
      const { join } = await import('path');
      const legacyPath = join(this.nginxConfigService.getNginxSitesPath(), 'primary-content.conf');

      try {
        await unlink(legacyPath);
        this.logger.log('Cleaned up legacy primary-content.conf');
      } catch {
        // File doesn't exist, that's fine
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup legacy primary content config: ${error}`);
    }
  }
}
