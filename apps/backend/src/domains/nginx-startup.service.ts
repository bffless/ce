import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { db } from '../db/client';
import {
  domainMappings,
  domainRedirects,
  projects,
  deploymentAliases,
  pathRedirects,
  aliasProxyRuleSets,
  projectDefaultProxyRuleSets,
} from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
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
   * Regenerates all nginx configs (domain mappings + redirects + primary content).
   *
   * Uses a bulk write strategy: every config is written to disk first, then a
   * single `waitForReload()` lets the nginx watcher debounce and reload once.
   * This collapses N × ~3s waits (N = total configs) into a single wait, which
   * matters at startup where serialized waits previously pushed cold-start
   * past the liveness probe budget on workspaces with many domains.
   */
  async regenerateAllConfigs(): Promise<void> {
    this.logger.log('Regenerating all nginx configs on startup...');

    // 0. Clean up orphaned config files (from previous installs or deleted mappings)
    await this.cleanupOrphanedConfigs();

    // 0.5. Clean up stale primary domain mapping if PRIMARY_DOMAIN changed
    await this.cleanupStalePrimaryDomainMapping();

    // 1. Regenerate all domain mapping configs (write only, no per-file wait)
    const domainCount = await this.regenerateDomainMappingConfigs();

    // 2. Regenerate all redirect configs (write only, no per-file wait)
    const redirectCount = await this.regenerateRedirectConfigs();

    // 3. Regenerate primary content config (write only)
    const primaryCount = await this.regeneratePrimaryContentConfig();

    // 4. Single wait for the nginx watcher to debounce + reload all the writes.
    if (domainCount + redirectCount + primaryCount > 0) {
      await this.nginxReloadService.waitForReload();
    }

    this.logger.log('Nginx config regeneration complete');
  }

  /**
   * Cleans up ALL domain and redirect nginx config files before regenerating.
   *
   * Why delete ALL configs instead of just orphaned ones?
   * - Nginx starts before backend finishes startup
   * - If a stale config has errors (e.g., SSL certs that don't exist), nginx crashes
   * - By the time backend cleans up orphaned configs, nginx is already in CrashLoopBackOff
   * - Deleting ALL configs and regenerating ensures a clean slate with current code/templates
   *
   * This also handles:
   * - App reinstalled but nginx volume persists
   * - Domain mappings deleted but config files weren't removed
   * - Template changes that need to be applied to all configs
   */
  private async cleanupOrphanedConfigs(): Promise<void> {
    const sitesPath = this.nginxConfigService.getNginxSitesPath();

    try {
      const { readdir, unlink } = await import('fs/promises');
      const { join } = await import('path');

      const files = await readdir(sitesPath);

      let cleanedCount = 0;

      for (const file of files) {
        // Delete ALL domain-*.conf files (will be regenerated from DB)
        if (file.match(/^domain-[a-f0-9-]+\.conf$/)) {
          this.logger.debug(`Removing domain config for regeneration: ${file}`);
          await unlink(join(sitesPath, file));
          cleanedCount++;
          continue;
        }

        // Delete ALL redirect-*.conf files (will be regenerated from DB)
        if (file.match(/^redirect-[a-f0-9-]+\.conf$/)) {
          this.logger.debug(`Removing redirect config for regeneration: ${file}`);
          await unlink(join(sitesPath, file));
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`Cleared ${cleanedCount} nginx config file(s) for regeneration`);
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup configs: ${error}`);
    }
  }

  /**
   * Runtime sweep that prunes orphan nginx config files — files on disk
   * whose UUID has no corresponding row in `domain_mappings` / `domain_redirects`.
   *
   * Different from `cleanupOrphanedConfigs` (startup): that one nukes every
   * domain-*.conf because regeneration immediately rewrites them. At runtime
   * that would 404 every live site for 2-5s, so this sweep is *selective* —
   * it only removes truly orphaned files. Safe to run on a live cluster.
   *
   * Triggered by:
   * - Hourly cron (defense-in-depth against any future leak)
   * - Manual call from project/domain delete paths once they exist
   */
  @Cron(CronExpression.EVERY_HOUR)
  async pruneOrphanNginxConfigs(): Promise<{ pruned: number; kept: number }> {
    if (process.env.NODE_ENV === 'test') {
      return { pruned: 0, kept: 0 };
    }

    const sitesPath = this.nginxConfigService.getNginxSitesPath();
    const { readdir, unlink } = await import('fs/promises');
    const { join } = await import('path');

    let files: string[];
    try {
      files = await readdir(sitesPath);
    } catch (error) {
      this.logger.warn(`pruneOrphanNginxConfigs: cannot read ${sitesPath}: ${error}`);
      return { pruned: 0, kept: 0 };
    }

    const domainRe = /^domain-([a-f0-9-]+)\.conf$/;
    const redirectRe = /^redirect-([a-f0-9-]+)\.conf$/;

    const fileEntries: Array<{ file: string; id: string; kind: 'domain' | 'redirect' }> = [];
    for (const file of files) {
      const dm = file.match(domainRe);
      if (dm) {
        fileEntries.push({ file, id: dm[1], kind: 'domain' });
        continue;
      }
      const rm = file.match(redirectRe);
      if (rm) {
        fileEntries.push({ file, id: rm[1], kind: 'redirect' });
      }
    }

    if (fileEntries.length === 0) {
      return { pruned: 0, kept: 0 };
    }

    const validDomainIds = new Set(
      (await db.select({ id: domainMappings.id }).from(domainMappings)).map((r) => r.id),
    );
    const validRedirectIds = new Set(
      (await db.select({ id: domainRedirects.id }).from(domainRedirects)).map((r) => r.id),
    );

    let pruned = 0;
    let kept = 0;
    for (const entry of fileEntries) {
      const valid = entry.kind === 'domain' ? validDomainIds : validRedirectIds;
      if (valid.has(entry.id)) {
        kept++;
        continue;
      }
      try {
        await unlink(join(sitesPath, entry.file));
        this.logger.warn(`Pruned orphan nginx config: ${entry.file}`);
        pruned++;
      } catch (error) {
        this.logger.warn(`Failed to prune ${entry.file}: ${error}`);
      }
    }

    if (pruned > 0) {
      this.logger.log(`Pruned ${pruned} orphan nginx config file(s); ${kept} kept`);
    }

    return { pruned, kept };
  }

  /**
   * Detects and cleans up stale primary domain mappings when PRIMARY_DOMAIN changes.
   *
   * This handles the case where a user changes their domain.txt file. The old primary
   * domain mapping in the database needs to be removed so it can be used as a custom domain.
   */
  private async cleanupStalePrimaryDomainMapping(): Promise<void> {
    const currentPrimaryDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    try {
      // Find any primary domain mapping in the database
      const [primaryMapping] = await db
        .select()
        .from(domainMappings)
        .where(eq(domainMappings.isPrimary, true))
        .limit(1);

      if (!primaryMapping) {
        // No primary domain mapping exists, nothing to clean up
        return;
      }

      // Check if the domain in the database matches the current PRIMARY_DOMAIN
      if (primaryMapping.domain === currentPrimaryDomain) {
        // Domain matches, no cleanup needed
        return;
      }

      // PRIMARY_DOMAIN has changed! The old mapping is stale.
      this.logger.warn(
        `PRIMARY_DOMAIN changed from "${primaryMapping.domain}" to "${currentPrimaryDomain}". ` +
          `Removing stale primary domain mapping to allow the old domain to be used as a custom domain.`,
      );

      // Delete the stale primary domain mapping
      await db.delete(domainMappings).where(eq(domainMappings.id, primaryMapping.id));

      // Also clean up the nginx config file for the old mapping
      const sitesPath = this.nginxConfigService.getNginxSitesPath();
      const { unlink } = await import('fs/promises');
      const { join } = await import('path');

      try {
        await unlink(join(sitesPath, `domain-${primaryMapping.id}.conf`));
        this.logger.log(`Removed nginx config for stale primary domain: ${primaryMapping.domain}`);
      } catch {
        // Config file may not exist, that's fine
      }

      this.logger.log(
        `Cleaned up stale primary domain mapping. You can now use "${primaryMapping.domain}" as a custom domain.`,
      );
    } catch (error) {
      this.logger.error(`Failed to cleanup stale primary domain mapping: ${error}`);
    }
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

      // Resolve rule set IDs: join table → legacy column → commit aliases → project default
      let ruleSetIds: string[] = [];

      // Check join table first
      const joinRows = await db
        .select({ proxyRuleSetId: aliasProxyRuleSets.proxyRuleSetId })
        .from(aliasProxyRuleSets)
        .where(eq(aliasProxyRuleSets.aliasId, alias[0].id))
        .orderBy(asc(aliasProxyRuleSets.order));

      if (joinRows.length > 0) {
        ruleSetIds = joinRows.map((r) => r.proxyRuleSetId);
      } else if (alias[0].proxyRuleSetId) {
        // Fall back to legacy column
        ruleSetIds = [alias[0].proxyRuleSetId];
      }

      // For preview aliases without rule sets, inherit ALL rule sets from manual aliases at same commit
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
        // Try project default: join table first, then legacy column
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

      // Get all enabled rules from the rule sets (merged)
      const rules = await this.proxyRulesService.getEffectiveRulesForMultipleRuleSets(ruleSetIds);

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

  /**
   * Regenerates nginx configs for all active domain mappings.
   *
   * Writes each config to its final location WITHOUT waiting for nginx to reload
   * — the caller (`regenerateAllConfigs`) does one final `waitForReload` after
   * every config is on disk. Returns the number of configs written so the caller
   * can decide whether to wait at all.
   */
  private async regenerateDomainMappingConfigs(): Promise<number> {
    const domains = await db.select().from(domainMappings).where(eq(domainMappings.isActive, true));

    if (domains.length === 0) {
      this.logger.log('No active domain mappings found');
      return 0;
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
        await this.nginxReloadService.writeConfigOnly(tempPath, finalPath);
        successCount++;
      } catch (error) {
        this.logger.error(`Failed to regenerate config for ${domain.domain}: ${error}`);
        errorCount++;
      }
    }

    this.logger.log(`Regenerated ${successCount} domain mapping configs (${errorCount} errors)`);
    return successCount;
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
   * Regenerates nginx configs for all active redirects.
   *
   * Same bulk-write pattern as `regenerateDomainMappingConfigs` — caller does
   * the single final wait. Returns the number of configs written.
   */
  private async regenerateRedirectConfigs(): Promise<number> {
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
      return 0;
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
        await this.nginxReloadService.writeConfigOnly(tempPath, finalPath);
        successCount++;
      } catch (error) {
        this.logger.error(
          `Failed to regenerate redirect config for ${redirect.sourceDomain}: ${error}`,
        );
        errorCount++;
      }
    }

    this.logger.log(`Regenerated ${successCount} redirect configs (${errorCount} errors)`);
    return successCount;
  }

  /**
   * Regenerates the primary content nginx config (www/root domain).
   *
   * - If an ACTIVE primary domain mapping exists, it's already handled by regenerateDomainMappingConfigs()
   * - If an INACTIVE primary domain mapping exists, generate a welcome page
   * - If no primary domain mapping exists, generate a welcome page
   *
   * Same bulk-write pattern — caller does the single final wait. Returns the
   * number of configs written (0 or 1).
   */
  private async regeneratePrimaryContentConfig(): Promise<number> {
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
      return 0;
    }

    // Either no primary domain mapping, or it's inactive - generate welcome page config
    try {
      const { tempPath, finalPath } = await this.nginxConfigService.generateWelcomePageConfig();

      const result = await this.nginxReloadService.writeConfigOnly(tempPath, finalPath);

      if (result.success) {
        const reason = primaryDomainMapping
          ? 'primary domain disabled'
          : 'no primary domain configured';
        this.logger.log(`Regenerated welcome page config (${reason})`);
        return 1;
      }
      this.logger.error(`Failed to write welcome page config: ${result.error}`);
      return 0;
    } catch (error) {
      this.logger.error(`Failed to regenerate welcome page config: ${error}`);
      return 0;
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
