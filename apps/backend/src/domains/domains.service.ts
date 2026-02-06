import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, SQL } from 'drizzle-orm';
import { promises as dns } from 'dns';
import { join } from 'path';
import { db } from '../db/client';
import { domainMappings, deploymentAliases, projects } from '../db/schema';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { NginxConfigService, NginxProxyRule } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { ProjectsService } from '../projects/projects.service';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService, DomainSslInfo } from './ssl-info.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';

const RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'admin',
  'mail',
  'ftp',
  'smtp',
  'pop',
  'imap',
  'dns',
  'ns',
  'mx',
  'localhost',
  'staging',
  'dev',
  'test',
  'prod',
  'production',
  'minio',
];

/**
 * Get the www/non-www alternate for a domain.
 * - www.example.com -> example.com
 * - example.com -> www.example.com
 * Returns null if not applicable (subdomains like api.example.com)
 */
function getAlternateDomain(domain: string): string | null {
  const parts = domain.split('.');

  // Must have at least 2 parts (example.com)
  if (parts.length < 2) {
    return null;
  }

  // If starts with www, return without www (apex domain)
  if (parts[0] === 'www') {
    return parts.slice(1).join('.');
  }

  // If it's an apex domain (exactly 2 parts like example.com), return with www
  // For domains like co.uk, we check if there are only 2 parts
  if (parts.length === 2) {
    return `www.${domain}`;
  }

  // Handle common two-part TLDs like .co.uk, .com.au, etc.
  const commonTwoPartTlds = ['co.uk', 'com.au', 'co.nz', 'org.uk', 'com.br', 'co.jp'];
  const lastTwo = parts.slice(-2).join('.');
  if (commonTwoPartTlds.includes(lastTwo) && parts.length === 3) {
    return `www.${domain}`;
  }

  // Otherwise it's a subdomain like api.example.com - no www alternate
  return null;
}

@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly nginxConfigService: NginxConfigService,
    private readonly nginxReloadService: NginxReloadService,
    private readonly projectsService: ProjectsService,
    private readonly sslCertificateService: SslCertificateService,
    private readonly sslInfoService: SslInfoService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly proxyRulesService: ProxyRulesService,
  ) {}

  /**
   * Check if running in platform mode (PaaS deployment).
   */
  private isPlatformMode(): boolean {
    return this.configService.get<string>('PLATFORM_MODE') === 'true';
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

  /**
   * Notify the Control Plane (L2) about domain changes.
   * Only called in PLATFORM_MODE for custom domains.
   *
   * This enables Traefik to route traffic and provision SSL certificates
   * for custom domains across the platform.
   *
   * @param action - 'add' or 'remove' the domain
   * @param domain - The domain name
   */
  private async notifyControlPlane(action: 'add' | 'remove', domain: string): Promise<void> {
    if (!this.isPlatformMode()) {
      return;
    }

    const controlPlaneUrl = this.configService.get<string>('CONTROL_PLANE_URL');
    const workspaceId = this.configService.get<string>('WORKSPACE_ID');
    const workspaceSecret = this.configService.get<string>('WORKSPACE_SECRET');

    if (!controlPlaneUrl || !workspaceId) {
      this.logger.warn(
        'PLATFORM_MODE is enabled but CONTROL_PLANE_URL or WORKSPACE_ID not configured. Skipping L2 notification.',
      );
      return;
    }

    if (!workspaceSecret) {
      this.logger.warn('WORKSPACE_SECRET not configured. Skipping Control Plane notification.');
      return;
    }

    const endpoint = `${controlPlaneUrl}/api/internal/workspaces/${workspaceId}/domains`;
    const method = action === 'add' ? 'POST' : 'DELETE';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Secret': workspaceSecret,
        },
        body: JSON.stringify({
          domain,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Failed to notify Control Plane about domain ${action}: ${response.status} ${errorText}`,
        );
      } else {
        this.logger.log(
          `Notified Control Plane: ${action} domain ${domain} for workspace ${workspaceId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to notify Control Plane about domain ${action}: ${error}`);
      // Don't throw - domain operation succeeded locally, L2 notification is best-effort
    }
  }

  /**
   * Notify the Control Plane that a domain's DNS has been verified.
   * This triggers Traefik to include the domain in routing and provision SSL.
   *
   * @param domain - The domain name
   * @param options - Additional options for alternate domains and redirect targets
   */
  private async notifyControlPlaneVerify(
    domain: string,
    options?: {
      alternateDomain?: string;
      wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
      domainType?: 'custom' | 'redirect';
      redirectTarget?: string;
    },
  ): Promise<void> {
    if (!this.isPlatformMode()) {
      return;
    }

    const controlPlaneUrl = this.configService.get<string>('CONTROL_PLANE_URL');
    const workspaceId = this.configService.get<string>('WORKSPACE_ID');
    const workspaceSecret = this.configService.get<string>('WORKSPACE_SECRET');

    if (!controlPlaneUrl || !workspaceId) {
      const msg =
        'PLATFORM_MODE is enabled but CONTROL_PLANE_URL or WORKSPACE_ID not configured. Cannot provision SSL.';
      this.logger.error(msg);
      throw new BadRequestException(msg);
    }

    if (!workspaceSecret) {
      const msg =
        'WORKSPACE_SECRET not configured. Cannot notify Control Plane to provision SSL certificate. Please contact your platform administrator.';
      this.logger.error(msg);
      throw new BadRequestException(msg);
    }

    const endpoint = `${controlPlaneUrl}/api/internal/workspaces/${workspaceId}/domains/verify`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Secret': workspaceSecret,
        },
        body: JSON.stringify({
          domain,
          alternateDomain: options?.alternateDomain,
          wwwBehavior: options?.wwwBehavior,
          domainType: options?.domainType || 'custom',
          redirectTarget: options?.redirectTarget,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Failed to notify Control Plane about domain verification: ${response.status} ${errorText}`,
        );
      } else {
        this.logger.log(
          `Notified Control Plane: domain ${domain} verified for workspace ${workspaceId}. SSL will be provisioned automatically.`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to notify Control Plane about domain verification: ${error}`);
      // Don't throw - verification succeeded locally, L2 notification is best-effort
    }
  }

  async create(createDomainDto: CreateDomainDto, userId: string, authToken?: string) {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    // Validate redirect domains have a target
    if (createDomainDto.domainType === 'redirect') {
      if (!createDomainDto.redirectTarget) {
        throw new BadRequestException('Redirect domains require a redirectTarget');
      }
      // Redirect domains cannot redirect to themselves
      if (createDomainDto.redirectTarget === createDomainDto.domain) {
        throw new BadRequestException('Redirect domain cannot redirect to itself');
      }
    }

    // For non-redirect domains, projectId is required
    if (createDomainDto.domainType !== 'redirect' && !createDomainDto.projectId) {
      throw new BadRequestException('projectId is required for subdomain and custom domains');
    }

    // Block custom domains when feature is disabled (e.g., PaaS with external SSL management)
    if (createDomainDto.domainType === 'custom') {
      const customDomainsEnabled =
        await this.featureFlagsService.isEnabled('ENABLE_CUSTOM_DOMAINS');
      if (!customDomainsEnabled) {
        throw new ForbiddenException(
          'Custom domains are not available. This platform manages SSL certificates externally.',
        );
      }
    }

    // Block www.{PRIMARY_DOMAIN} and {PRIMARY_DOMAIN} unless creating a primary domain mapping
    if (
      (createDomainDto.domain === `www.${baseDomain}` || createDomainDto.domain === baseDomain) &&
      !createDomainDto.isPrimary
    ) {
      throw new ConflictException(
        `Domain "${createDomainDto.domain}" is reserved for primary content. Configure primary content in Settings.`,
      );
    }

    // If creating a primary domain mapping, ensure only one can exist
    if (createDomainDto.isPrimary) {
      const existingPrimary = await db
        .select()
        .from(domainMappings)
        .where(eq(domainMappings.isPrimary, true))
        .limit(1);

      if (existingPrimary.length > 0) {
        throw new ConflictException(
          'A primary domain mapping already exists. Update the existing one or delete it first.',
        );
      }

      // Primary domains must use the PRIMARY_DOMAIN
      if (createDomainDto.domain !== baseDomain) {
        throw new BadRequestException(
          `Primary domain mapping must use the base domain: ${baseDomain}`,
        );
      }

      // Primary domains must specify wwwBehavior
      if (!createDomainDto.wwwBehavior) {
        createDomainDto.wwwBehavior = 'redirect-to-www'; // Default behavior
      }
    }

    // Check if domain already exists (do this first for better error message)
    const existing = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.domain, createDomainDto.domain))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Domain "${createDomainDto.domain}" already exists`);
    }

    // Validate subdomain not reserved
    if (createDomainDto.domainType === 'subdomain') {
      const subdomain = createDomainDto.domain.split('.')[0];
      if (RESERVED_SUBDOMAINS.includes(subdomain)) {
        throw new ConflictException(`Subdomain "${subdomain}" is reserved`);
      }
    }

    // Mutual exclusivity check: www/non-www alternate cannot exist separately
    // This ensures we handle www redirects via wwwBehavior, not separate domain mappings
    const alternateDomain = getAlternateDomain(createDomainDto.domain);
    if (alternateDomain && createDomainDto.domainType !== 'redirect') {
      const existingAlternate = await db
        .select()
        .from(domainMappings)
        .where(eq(domainMappings.domain, alternateDomain))
        .limit(1);

      if (existingAlternate.length > 0) {
        throw new ConflictException(
          `Cannot add ${createDomainDto.domain}: ${alternateDomain} already exists as a domain mapping. ` +
            `Configure the www/apex redirect in ${alternateDomain}'s settings instead.`,
        );
      }
    }

    // Validate path if provided
    if (createDomainDto.path) {
      this.validatePath(createDomainDto.path);
    }

    // For redirect domains, we don't need a project
    // For other domains, get project details for nginx config
    let project: { owner: string; name: string } | null = null;
    if (createDomainDto.projectId) {
      project = await this.projectsService.getProjectById(createDomainDto.projectId);
    }

    // Force custom/redirect domains to be public since authentication cookies don't work cross-domain
    // Exception: Primary domains can be private since they're on the same base domain
    // Subdomains can inherit or override visibility since they share the same domain
    const isPublic =
      (createDomainDto.domainType === 'custom' || createDomainDto.domainType === 'redirect') &&
      !createDomainDto.isPrimary
        ? true // Custom/redirect non-primary domains must be public
        : createDomainDto.isPublic; // Primary domains and subdomains can use provided value or inherit (null)

    // For custom/redirect domains, SSL must be requested separately after DNS verification.
    // Force sslEnabled=false on creation to prevent nginx config from referencing non-existent certs.
    // For subdomains, SSL can be enabled if wildcard cert exists.
    // In platform mode, SSL is managed externally (GCP LB, Traefik, etc.) so subdomains default to sslEnabled=true.
    let sslEnabled = createDomainDto.sslEnabled ?? false;
    if (createDomainDto.domainType === 'custom' || createDomainDto.domainType === 'redirect') {
      if (createDomainDto.sslEnabled) {
        this.logger.warn(
          `${createDomainDto.domainType} domain ${createDomainDto.domain}: Ignoring sslEnabled=true on creation. ` +
            `SSL must be requested separately after DNS verification.`,
        );
      }
      sslEnabled = false;
    } else if (createDomainDto.domainType === 'subdomain') {
      if (this.isPlatformMode()) {
        // In platform mode, SSL is handled externally — always enable for subdomains
        sslEnabled = true;
      } else if (createDomainDto.sslEnabled) {
        // For self-hosted, check if wildcard cert exists before enabling SSL
        const wildcardStatus = await this.getWildcardCertificateStatus();
        if (!wildcardStatus.exists) {
          this.logger.warn(
            `Subdomain ${createDomainDto.domain}: Ignoring sslEnabled=true - wildcard certificate not found`,
          );
          sslEnabled = false;
        }
      }
    }

    // Create domain mapping in database
    const [domainMapping] = await db
      .insert(domainMappings)
      .values({
        ...createDomainDto,
        isPublic,
        sslEnabled, // Override with validated value (false for custom/redirect domains until certs obtained)
        createdBy: userId,
        dnsVerified: createDomainDto.domainType === 'subdomain', // Auto-verify subdomains
      })
      .returning();

    // Generate nginx config
    try {
      let tempPath: string;
      let finalPath: string;

      if (domainMapping.domainType === 'redirect') {
        // Redirect domain: use redirect config generator
        const config = await this.nginxConfigService.generateRedirectDomainConfig({
          id: domainMapping.id,
          domain: domainMapping.domain,
          redirectTarget: domainMapping.redirectTarget!,
          sslEnabled: domainMapping.sslEnabled,
        });
        const result = await this.nginxConfigService.writeConfigFile(domainMapping.id, config);
        tempPath = result.tempPath;
        finalPath = result.finalPath;
      } else if (domainMapping.isPrimary) {
        // Get nginx proxy rules with authTransform for this domain
        const proxyRules = await this.getNginxProxyRulesForDomain(
          domainMapping.projectId!,
          domainMapping.alias,
        );

        // Primary domain: use special config generator with www handling and proxy rules
        const result = await this.nginxConfigService.generatePrimaryDomainConfig({
          id: domainMapping.id,
          owner: project!.owner,
          repo: project!.name,
          alias: domainMapping.alias || 'latest',
          path: domainMapping.path || '',
          wwwBehavior: domainMapping.wwwBehavior as
            | 'redirect-to-www'
            | 'redirect-to-root'
            | 'serve-both'
            | null,
          isSpa: domainMapping.isSpa,
          proxyRules,
        });
        tempPath = result.tempPath;
        finalPath = result.finalPath;
      } else {
        // Get nginx proxy rules with authTransform for this domain
        const proxyRules = await this.getNginxProxyRulesForDomain(
          domainMapping.projectId!,
          domainMapping.alias,
        );

        // Regular domain: use standard config generator
        const config = await this.nginxConfigService.generateConfig(
          domainMapping,
          project!,
          proxyRules,
        );
        const result = await this.nginxConfigService.writeConfigFile(domainMapping.id, config);
        tempPath = result.tempPath;
        finalPath = result.finalPath;
      }

      // Move config to final location and let watcher reload
      const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);

      if (!result.success) {
        // Rollback: delete domain mapping from database
        this.logger.error(`Nginx reload failed, rolling back domain creation: ${result.error}`);
        await db.delete(domainMappings).where(eq(domainMappings.id, domainMapping.id));
        throw new ConflictException(`Failed to reload nginx: ${result.error}`);
      }

      // Update domain mapping with nginx config path
      const [updated] = await db
        .update(domainMappings)
        .set({ nginxConfigPath: finalPath })
        .where(eq(domainMappings.id, domainMapping.id))
        .returning();

      this.logger.log(`Domain mapping created successfully: ${updated.domain}`);

      // Notify Control Plane (L2) for custom and redirect domains in PLATFORM_MODE
      // This enables Traefik to route and provision SSL for the domain
      if (updated.domainType === 'custom' || updated.domainType === 'redirect') {
        await this.notifyControlPlane('add', updated.domain);
      }

      return updated;
    } catch (error) {
      // If nginx config generation/write fails, rollback the domain mapping
      if (!(error instanceof ConflictException)) {
        this.logger.error(`Failed to generate nginx config, rolling back: ${error}`);
        await db.delete(domainMappings).where(eq(domainMappings.id, domainMapping.id));
      }
      throw error;
    }
  }

  async findAll(
    _userId: string,
    filters?: {
      projectId?: string;
      domainType?: string;
      isActive?: boolean;
    },
  ) {
    // Get user's accessible projects (owned + shared)
    // For now, return all (will add permission filtering later)

    const query = db.select().from(domainMappings);

    const conditions: SQL[] = [];

    // Always exclude primary domains from the list - they're managed via Settings
    conditions.push(eq(domainMappings.isPrimary, false));

    if (filters?.projectId) {
      conditions.push(eq(domainMappings.projectId, filters.projectId));
    }

    if (filters?.domainType) {
      conditions.push(eq(domainMappings.domainType, filters.domainType));
    }

    if (filters?.isActive !== undefined) {
      conditions.push(eq(domainMappings.isActive, filters.isActive));
    }

    const results = await query.where(and(...conditions));

    // In platform mode, SSL is managed externally for subdomains — report as enabled
    if (this.isPlatformMode()) {
      return results.map((d) =>
        d.domainType === 'subdomain' ? { ...d, sslEnabled: true } : d,
      );
    }

    return results;
  }

  async findOne(id: string, _userId: string) {
    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, id))
      .limit(1);

    if (!domainMapping) {
      throw new NotFoundException(`Domain mapping with ID ${id} not found`);
    }

    // TODO: Check user has permission to view this domain's project

    // In platform mode, SSL is managed externally for subdomains — report as enabled
    if (this.isPlatformMode() && domainMapping.domainType === 'subdomain') {
      return { ...domainMapping, sslEnabled: true };
    }

    return domainMapping;
  }

  async update(id: string, updateDomainDto: UpdateDomainDto, userId: string) {
    // Check domain exists and get current data
    const existing = await this.findOne(id, userId);

    // Validate path if provided (not applicable for redirect domains)
    if (updateDomainDto.path && existing.domainType !== 'redirect') {
      this.validatePath(updateDomainDto.path);
    }

    // Get project details for nginx config (not needed for redirect domains)
    const project = existing.domainType !== 'redirect' && existing.projectId
      ? await this.projectsService.getProjectById(existing.projectId)
      : null;

    // Force custom domains to remain public (cannot be set to private)
    // Authentication cookies don't work cross-domain
    // Exception: Primary domains can be private since they're on the same base domain
    let isPublicValue = updateDomainDto.isPublic;
    if (
      existing.domainType === 'custom' &&
      !existing.isPrimary &&
      updateDomainDto.isPublic === false
    ) {
      this.logger.warn(
        `Ignoring attempt to set custom domain ${existing.domain} to private - custom domains must be public`,
      );
      isPublicValue = true; // Force it to remain public
    }

    // Update database
    const [updated] = await db
      .update(domainMappings)
      .set({
        ...updateDomainDto,
        isPublic: isPublicValue,
        updatedAt: new Date(),
      })
      .where(eq(domainMappings.id, id))
      .returning();

    // Regenerate nginx config if the mapping affects routing
    if (
      updateDomainDto.alias !== undefined ||
      updateDomainDto.path !== undefined ||
      updateDomainDto.isActive !== undefined ||
      updateDomainDto.isSpa !== undefined ||
      updateDomainDto.wwwBehavior !== undefined
    ) {
      try {
        if (updated.isActive) {
          let tempPath: string;
          let finalPath: string;

          // Handle redirect domains separately - they don't have a project
          if (updated.domainType === 'redirect') {
            // Redirect domain: use redirect config generator
            const config = await this.nginxConfigService.generateRedirectDomainConfig({
              id: updated.id,
              domain: updated.domain,
              redirectTarget: updated.redirectTarget!,
              sslEnabled: updated.sslEnabled,
            });
            const result = await this.nginxConfigService.writeConfigFile(updated.id, config);
            tempPath = result.tempPath;
            finalPath = result.finalPath;
          } else if (updated.isPrimary) {
            // Get nginx proxy rules with authTransform for this domain
            const proxyRules = await this.getNginxProxyRulesForDomain(
              updated.projectId!,
              updated.alias,
            );

            // Primary domain being re-enabled: clean up welcome page config first
            const welcomePagePath = join(
              this.nginxConfigService.getNginxSitesPath(),
              'primary-content.conf',
            );
            try {
              await this.nginxConfigService.deleteConfigFile(welcomePagePath);
              this.logger.log(
                'Removed welcome page config before generating primary domain config',
              );
            } catch {
              // Welcome page config may not exist, that's fine
            }

            // Primary domain: use special config generator with www handling and proxy rules
            const result = await this.nginxConfigService.generatePrimaryDomainConfig({
              id: updated.id,
              owner: project!.owner,
              repo: project!.name,
              alias: updated.alias || 'latest',
              path: updated.path || '',
              wwwBehavior: updated.wwwBehavior as
                | 'redirect-to-www'
                | 'redirect-to-root'
                | 'serve-both'
                | null,
              isSpa: updated.isSpa,
              proxyRules,
            });
            tempPath = result.tempPath;
            finalPath = result.finalPath;
          } else {
            // Get nginx proxy rules with authTransform for this domain
            const proxyRules = await this.getNginxProxyRulesForDomain(
              updated.projectId!,
              updated.alias,
            );

            // Regular domain: use standard config generator
            const config = await this.nginxConfigService.generateConfig(
              updated,
              project!,
              proxyRules,
            );
            const result = await this.nginxConfigService.writeConfigFile(updated.id, config);
            tempPath = result.tempPath;
            finalPath = result.finalPath;
          }

          const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);

          if (!result.success) {
            this.logger.warn(`Nginx reload failed after update: ${result.error}`);
            // Don't rollback the database update, but log the warning
            // The config can be fixed manually or on next update
          }

          // Update nginx config path if changed
          if (updated.nginxConfigPath !== finalPath) {
            await db
              .update(domainMappings)
              .set({ nginxConfigPath: finalPath })
              .where(eq(domainMappings.id, id));
          }
        } else {
          // Domain was deactivated
          if (updated.isPrimary) {
            // Primary domain: generate welcome page config instead of removing
            this.logger.log(`Primary domain deactivated - generating welcome page config`);

            // First, remove the old domain config file (domain-{id}.conf)
            if (existing.nginxConfigPath) {
              try {
                await this.nginxConfigService.deleteConfigFile(existing.nginxConfigPath);
                await db
                  .update(domainMappings)
                  .set({ nginxConfigPath: null })
                  .where(eq(domainMappings.id, id));
              } catch (err) {
                this.logger.warn(`Failed to remove old primary domain config: ${err}`);
              }
            }

            // Then generate the welcome page config (primary-content.conf)
            const { tempPath, finalPath } =
              await this.nginxConfigService.generateWelcomePageConfig();
            const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);

            if (!result.success) {
              this.logger.warn(`Failed to generate welcome page config: ${result.error}`);
            }
          } else if (existing.nginxConfigPath) {
            // Regular domain: remove the config
            await this.nginxReloadService.removeConfigAndReload(existing.nginxConfigPath);
            await db
              .update(domainMappings)
              .set({ nginxConfigPath: null })
              .where(eq(domainMappings.id, id));
          }
        }
      } catch (error) {
        this.logger.error(`Failed to update nginx config: ${error}`);
        // Don't fail the request - the domain mapping is updated, nginx config can be fixed later
      }

      // In PLATFORM_MODE, notify Control Plane when wwwBehavior changes for custom domains
      // This creates/updates the alternate domain IngressRoute in Kubernetes
      if (
        this.isPlatformMode() &&
        updateDomainDto.wwwBehavior !== undefined &&
        updated.domainType === 'custom' &&
        updated.dnsVerified
      ) {
        const alternateDomain = getAlternateDomain(updated.domain);
        if (alternateDomain) {
          try {
            await this.notifyControlPlaneVerify(updated.domain, {
              alternateDomain,
              wwwBehavior: updated.wwwBehavior as
                | 'redirect-to-www'
                | 'redirect-to-root'
                | 'serve-both'
                | undefined,
              domainType: 'custom',
            });
            this.logger.log(
              `Notified Control Plane about wwwBehavior change for ${updated.domain}`,
            );
          } catch (err) {
            this.logger.error(`Failed to notify Control Plane about wwwBehavior change: ${err}`);
            // Don't fail - the domain is updated locally
          }
        }
      }
    }

    return updated;
  }

  async remove(id: string, userId: string, authToken?: string) {
    const existing = await this.findOne(id, userId);

    // Delete from database
    await db.delete(domainMappings).where(eq(domainMappings.id, id));

    // Remove nginx config and reload
    if (existing.nginxConfigPath) {
      try {
        await this.nginxReloadService.removeConfigAndReload(existing.nginxConfigPath);
        this.logger.log(`Removed nginx config for domain: ${existing.domain}`);
      } catch (error) {
        this.logger.warn(
          `Failed to remove nginx config (domain already deleted from DB): ${error}`,
        );
        // Don't fail the request - the domain mapping is already deleted
      }
    }

    // Notify Control Plane (L2) for custom and redirect domains in PLATFORM_MODE
    // This removes the Traefik route for the domain
    if (existing.domainType === 'custom' || existing.domainType === 'redirect') {
      await this.notifyControlPlane('remove', existing.domain);
    }

    return { success: true, nginxConfigPath: existing.nginxConfigPath };
  }

  // =====================
  // Primary Domain Methods
  // =====================

  /**
   * Get the primary domain mapping (if exists).
   * Returns null if no primary domain is configured.
   */
  async getPrimaryDomain(): Promise<typeof domainMappings.$inferSelect | null> {
    const [primary] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.isPrimary, true))
      .limit(1);

    return primary || null;
  }

  /**
   * Get the primary domain mapping with project details.
   */
  async getPrimaryDomainWithDetails() {
    const primary = await this.getPrimaryDomain();
    if (!primary) {
      return null;
    }

    // Primary domains always have a projectId (only redirect domains can be without a project)
    if (!primary.projectId) {
      this.logger.error('Primary domain has no projectId - this should not happen');
      return null;
    }

    const project = await this.projectsService.getProjectById(primary.projectId);
    return {
      ...primary,
      projectOwner: project.owner,
      projectName: project.name,
    };
  }

  /**
   * Enable/disable primary domain content and regenerate nginx config.
   */
  async updatePrimaryDomainActive(
    isActive: boolean,
    userId: string,
  ): Promise<typeof domainMappings.$inferSelect | null> {
    const primary = await this.getPrimaryDomain();
    if (!primary) {
      return null;
    }

    return this.update(primary.id, { isActive }, userId);
  }

  // =====================
  // Wildcard SSL Methods
  // =====================

  async startWildcardCertificateRequest() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      throw new BadRequestException('PRIMARY_DOMAIN environment variable not set');
    }

    const challenge = await this.sslCertificateService.startWildcardCertificateRequest(baseDomain);

    // Build instructions - handle multiple TXT records for wildcard certs
    const instructions =
      challenge.recordValues.length > 1
        ? [
            `1. Go to your DNS provider (Cloudflare, Route53, GoDaddy, etc.)`,
            `2. Add ${challenge.recordValues.length} TXT records (same name, different values):`,
            `   - Name: ${challenge.recordName}`,
            `   - Type: TXT`,
            ...challenge.recordValues.map((v, i) => `   - Value ${i + 1}: ${v}`),
            `3. Wait 1-2 minutes for DNS propagation`,
            `4. Click "Verify & Issue Certificate"`,
          ]
        : [
            `1. Go to your DNS provider (Cloudflare, Route53, GoDaddy, etc.)`,
            `2. Add a TXT record:`,
            `   - Name: ${challenge.recordName}`,
            `   - Type: TXT`,
            `   - Value: ${challenge.recordValue}`,
            `3. Wait 1-2 minutes for DNS propagation`,
            `4. Click "Verify & Issue Certificate"`,
          ];

    return {
      message:
        challenge.recordValues.length > 1
          ? `Add ${challenge.recordValues.length} DNS TXT records to verify domain ownership (same name, different values)`
          : 'Add the following DNS TXT record to verify domain ownership',
      recordName: challenge.recordName,
      recordType: 'TXT',
      recordValue: challenge.recordValue,
      recordValues: challenge.recordValues,
      domain: challenge.domain,
      instructions,
      expiresAt: challenge.expiresAt,
    };
  }

  async completeWildcardCertificateRequest() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      throw new BadRequestException('PRIMARY_DOMAIN environment variable not set');
    }

    const result = await this.sslCertificateService.completeWildcardCertificateRequest(baseDomain);

    if (result.success) {
      // Enable SSL for all existing subdomains
      await this.enableSslForAllSubdomains();

      return {
        success: true,
        message: 'Wildcard certificate issued successfully',
        expiresAt: result.expiresAt,
      };
    }

    return {
      success: false,
      error: result.error,
      message:
        'DNS verification failed. Please ensure the TXT record is correct and has propagated.',
    };
  }

  async getWildcardCertificateStatus() {
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';
    return this.sslCertificateService.checkWildcardCertificate(baseDomain);
  }

  async getPendingWildcardChallenge() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) return null;

    return this.sslCertificateService.getPendingChallenge(baseDomain);
  }

  async checkWildcardDnsPropagation() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      return { error: 'PRIMARY_DOMAIN not configured' };
    }

    return this.sslCertificateService.checkDnsPropagation(baseDomain);
  }

  async deleteWildcardCertificate() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      throw new BadRequestException('PRIMARY_DOMAIN environment variable not set');
    }

    const result = await this.sslCertificateService.deleteWildcardCertificate(baseDomain);

    if (result.success) {
      // Disable SSL for all subdomains
      await this.disableSslForAllSubdomains();

      // Regenerate nginx configs without SSL
      await this.regenerateAllNginxConfigs();

      return {
        success: true,
        message: 'Wildcard certificate deleted. SSL disabled for all subdomains.',
      };
    }

    throw new NotFoundException(result.error || 'Certificate not found');
  }

  async cancelPendingWildcardChallenge() {
    const baseDomain = process.env.PRIMARY_DOMAIN;
    if (!baseDomain) {
      throw new BadRequestException('PRIMARY_DOMAIN environment variable not set');
    }

    const result = await this.sslCertificateService.cancelPendingChallenge(baseDomain);

    if (!result.success) {
      throw new NotFoundException(result.error || 'No pending challenge found');
    }

    return {
      success: true,
      message: 'Pending certificate request cancelled.',
    };
  }

  private async disableSslForAllSubdomains() {
    await db
      .update(domainMappings)
      .set({
        sslEnabled: false,
        sslExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(domainMappings.domainType, 'subdomain'));

    this.logger.log('Disabled SSL for all subdomains');
  }

  private async regenerateAllNginxConfigs() {
    const domains = await db.select().from(domainMappings).where(eq(domainMappings.isActive, true));

    for (const domain of domains) {
      try {
        let config: string;

        // Handle redirect domains separately
        if (domain.domainType === 'redirect') {
          config = await this.nginxConfigService.generateRedirectDomainConfig({
            id: domain.id,
            domain: domain.domain,
            redirectTarget: domain.redirectTarget!,
            sslEnabled: false,
          });
        } else {
          // Non-redirect domains require a project
          if (!domain.projectId) {
            this.logger.warn(`Skipping domain ${domain.domain} - no projectId`);
            continue;
          }

          const project = await this.projectsService.getProjectById(domain.projectId);

          // Get nginx proxy rules with authTransform for this domain
          const proxyRules = await this.getNginxProxyRulesForDomain(domain.projectId, domain.alias);

          config = await this.nginxConfigService.generateConfig(
            { ...domain, sslEnabled: false },
            project,
            proxyRules,
          );
        }

        const { tempPath, finalPath } = await this.nginxConfigService.writeConfigFile(
          domain.id,
          config,
        );
        await this.nginxReloadService.validateAndReload(tempPath, finalPath);
      } catch (error) {
        this.logger.error(`Failed to regenerate config for ${domain.domain}: ${error}`);
      }
    }

    this.logger.log(`Regenerated ${domains.length} nginx configs without SSL`);
  }

  // =====================
  // Per-Domain SSL Methods
  // =====================

  async requestDomainSsl(id: string, userId: string) {
    const domain = await this.findOne(id, userId);

    if (domain.domainType === 'subdomain') {
      // Check if wildcard cert exists
      const wildcardStatus = await this.getWildcardCertificateStatus();
      if (wildcardStatus.exists) {
        // Enable SSL using wildcard cert
        await this.enableDomainSsl(id);
        return {
          success: true,
          message: 'SSL enabled using wildcard certificate',
        };
      }
      return {
        success: false,
        message: 'Wildcard certificate not found. Request one first.',
      };
    }

    // Custom domain - use HTTP-01 challenge
    if (!domain.dnsVerified) {
      return {
        success: false,
        message: 'DNS must be verified before requesting SSL certificate',
      };
    }

    // Check if alternate domain (www/non-www) is also verified
    const alternateDomain = getAlternateDomain(domain.domain);
    let verifiedAlternateDomain: string | undefined;

    if (alternateDomain) {
      const alternateStatus = await this.checkAlternateDomainDns(alternateDomain);
      if (alternateStatus.verified) {
        verifiedAlternateDomain = alternateDomain;
        this.logger.log(
          `Including alternate domain ${alternateDomain} in certificate for ${domain.domain}`,
        );
      } else {
        this.logger.log(
          `Alternate domain ${alternateDomain} not verified, requesting cert for ${domain.domain} only`,
        );
      }
    }

    const result = await this.sslCertificateService.requestCustomDomainCertificate(
      domain.domain,
      verifiedAlternateDomain,
    );

    if (result.success) {
      await this.enableDomainSsl(id, result.expiresAt);

      // Return info about which domains are covered
      return {
        ...result,
        message: verifiedAlternateDomain
          ? `SSL certificate issued for ${domain.domain} and ${verifiedAlternateDomain}`
          : `SSL certificate issued for ${domain.domain}`,
        domains: result.domains,
      };
    }

    return result;
  }

  async getDomainSslStatus(id: string, userId: string) {
    const domain = await this.findOne(id, userId);

    if (domain.domainType === 'subdomain') {
      const wildcardStatus = await this.getWildcardCertificateStatus();
      return {
        type: 'wildcard',
        enabled: domain.sslEnabled,
        certificate: wildcardStatus,
      };
    }

    const certInfo = await this.sslCertificateService.checkCustomDomainCertificate(domain.domain);
    return {
      type: 'custom',
      enabled: domain.sslEnabled,
      certificate: certInfo,
      expiresAt: domain.sslExpiresAt,
    };
  }

  // =====================
  // Phase B: SSL Info Methods
  // =====================

  /**
   * Get detailed SSL certificate info for a domain
   * For subdomains: returns wildcard certificate info (read-only)
   * For custom domains: returns individual certificate info with renewal options
   */
  async getDomainSslDetails(id: string, userId: string): Promise<DomainSslInfo | null> {
    const domain = await this.findOne(id, userId);

    if (!domain.sslEnabled) {
      return {
        domainId: domain.id,
        domain: domain.domain,
        sslEnabled: false,
        autoRenewEnabled: domain.autoRenewSsl ?? true,
        lastRenewalAt: domain.sslRenewedAt,
        lastRenewalStatus: domain.sslRenewalStatus as 'success' | 'failed' | null,
        type: domain.domainType === 'subdomain' ? 'wildcard' : 'individual',
        commonName: '',
        issuer: '',
        issuedAt: new Date(),
        expiresAt: new Date(),
        daysUntilExpiry: 0,
        isValid: false,
        isExpiringSoon: false,
        serialNumber: '',
        fingerprint: '',
      };
    }

    const certInfo = await this.sslInfoService.getDomainSslInfo(
      domain.domain,
      domain.domainType as 'subdomain' | 'custom',
    );

    if (!certInfo) {
      return null;
    }

    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    return {
      domainId: domain.id,
      domain: domain.domain,
      sslEnabled: domain.sslEnabled,
      autoRenewEnabled: domain.autoRenewSsl ?? true,
      lastRenewalAt: domain.sslRenewedAt,
      lastRenewalStatus: domain.sslRenewalStatus as 'success' | 'failed' | null,
      wildcardCertDomain: domain.domainType === 'subdomain' ? `*.${baseDomain}` : undefined,
      ...certInfo,
    };
  }

  /**
   * Manually renew SSL certificate for a domain
   * Only available for custom domains - subdomains use wildcard cert
   */
  async manualRenewCertificate(
    id: string,
    userId: string,
  ): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
  }> {
    const domain = await this.findOne(id, userId);

    if (domain.domainType === 'subdomain') {
      return {
        success: false,
        error: 'Subdomains use the wildcard certificate. Renew the wildcard certificate instead.',
      };
    }

    // For custom domains, renew the individual certificate
    const result = await this.sslCertificateService.requestCustomDomainCertificate(domain.domain);

    if (result.success) {
      // Update domain with renewal status
      await db
        .update(domainMappings)
        .set({
          sslRenewedAt: new Date(),
          sslRenewalStatus: 'success',
          sslRenewalError: null,
          sslExpiresAt: result.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(domainMappings.id, id));

      this.logger.log(`SSL certificate renewed for ${domain.domain}`);
    } else {
      // Record the failure
      await db
        .update(domainMappings)
        .set({
          sslRenewalStatus: 'failed',
          sslRenewalError: result.error || 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(domainMappings.id, id));

      this.logger.warn(`SSL certificate renewal failed for ${domain.domain}: ${result.error}`);
    }

    return result;
  }

  /**
   * Update auto-renewal setting for a domain
   */
  async updateAutoRenewSetting(
    id: string,
    userId: string,
    enabled: boolean,
  ): Promise<{ autoRenewEnabled: boolean }> {
    await this.findOne(id, userId); // Permission check

    await db
      .update(domainMappings)
      .set({
        autoRenewSsl: enabled,
        updatedAt: new Date(),
      })
      .where(eq(domainMappings.id, id));

    return { autoRenewEnabled: enabled };
  }

  /**
   * Get wildcard certificate details (for platform-level display)
   */
  async getWildcardCertDetails(): Promise<{
    certificate: {
      type: 'wildcard';
      commonName: string;
      issuer: string;
      issuedAt: Date;
      expiresAt: Date;
      daysUntilExpiry: number;
      isValid: boolean;
      isExpiringSoon: boolean;
      serialNumber: string;
      fingerprint: string;
    } | null;
    pendingChallenge: {
      recordName: string;
      recordValue: string;
      expiresAt: Date;
    } | null;
    baseDomain: string;
  }> {
    const certInfo = await this.sslInfoService.getWildcardCertInfo();
    const pendingChallenge = await this.getPendingWildcardChallenge();

    return {
      certificate: certInfo as {
        type: 'wildcard';
        commonName: string;
        issuer: string;
        issuedAt: Date;
        expiresAt: Date;
        daysUntilExpiry: number;
        isValid: boolean;
        isExpiringSoon: boolean;
        serialNumber: string;
        fingerprint: string;
      } | null,
      pendingChallenge: pendingChallenge
        ? {
            recordName: pendingChallenge.recordName,
            recordValue: pendingChallenge.recordValue,
            expiresAt: pendingChallenge.expiresAt,
          }
        : null,
      baseDomain: process.env.PRIMARY_DOMAIN || 'localhost',
    };
  }

  // =====================
  // DNS Verification Methods
  // =====================

  /**
   * Verify DNS for a custom domain.
   *
   * In platform mode (PaaS): Verifies DNS A record points to the platform IP.
   * This is sufficient because Traefik handles routing and SSL provisioning.
   *
   * In self-hosted mode: Makes an HTTP request to verify nginx is serving the domain.
   *
   * Also checks for www/non-www alternate domain to enable SAN certificates.
   */
  async verifyCustomDomainDns(
    id: string,
    userId: string,
    authToken?: string,
  ): Promise<{
    success: boolean;
    verified: boolean;
    domain: string;
    resolvedIps?: string[];
    error?: string;
    alternateDomain?: string | null;
    alternateDomainVerified?: boolean;
    alternateDomainIps?: string[];
    alternateDomainError?: string;
    alternateDomainDnsInstructions?: {
      recordType: string;
      host: string;
      value: string;
      note: string;
    };
  }> {
    const domain = await this.findOne(id, userId);

    if (domain.domainType !== 'custom' && domain.domainType !== 'redirect') {
      return {
        success: false,
        verified: false,
        domain: domain.domain,
        error: 'DNS verification is only required for custom and redirect domains',
      };
    }

    // Get the www/non-www alternate domain
    const alternateDomain = getAlternateDomain(domain.domain);

    // If already verified, just check the alternate domain status
    if (domain.dnsVerified) {
      const alternateStatus = alternateDomain
        ? await this.checkAlternateDomainDns(alternateDomain)
        : null;

      return {
        success: true,
        verified: true,
        domain: domain.domain,
        alternateDomain,
        alternateDomainVerified: alternateStatus?.verified ?? false,
        alternateDomainIps: alternateStatus?.resolvedIps,
        alternateDomainError: alternateStatus?.error,
        alternateDomainDnsInstructions: alternateStatus?.dnsInstructions,
      };
    }

    try {
      // First, check if DNS resolves at all
      let resolvedIps: string[] = [];
      try {
        resolvedIps = await dns.resolve4(domain.domain);
        this.logger.log(`DNS lookup for ${domain.domain}: ${resolvedIps.join(', ')}`);
      } catch (dnsError) {
        const errCode = (dnsError as NodeJS.ErrnoException).code;
        if (errCode === 'ENODATA' || errCode === 'ENOTFOUND') {
          return {
            success: false,
            verified: false,
            domain: domain.domain,
            error: `No A record found for ${domain.domain}. Add an A record pointing to this server's IP address.`,
            alternateDomain,
          };
        }
        throw dnsError;
      }

      // In platform mode, verify by checking DNS points to the platform IP
      // We can't make HTTP requests because Traefik doesn't route the domain yet
      if (this.isPlatformMode()) {
        const expectedIp = await this.getPlatformIp();

        if (!expectedIp) {
          return {
            success: false,
            verified: false,
            domain: domain.domain,
            resolvedIps,
            error: 'Could not determine platform IP address. Please contact support.',
            alternateDomain,
          };
        }

        if (resolvedIps.includes(expectedIp)) {
          // DNS is pointing to the correct platform IP
          // Notify Control Plane FIRST so Traefik can provision SSL
          // This throws if configuration is missing, preventing false verification
          // Include alternate domain and wwwBehavior for proper routing setup
          const domainType = domain.domainType as 'custom' | 'redirect';
          await this.notifyControlPlaneVerify(domain.domain, {
            alternateDomain: alternateDomain || undefined,
            wwwBehavior: domain.wwwBehavior as
              | 'redirect-to-www'
              | 'redirect-to-root'
              | 'serve-both'
              | undefined,
            domainType,
            redirectTarget: domain.redirectTarget || undefined,
          });

          // Only update database after successful Control Plane notification
          // In platform mode, SSL is always provisioned by cert-manager after DNS verification
          await db
            .update(domainMappings)
            .set({
              dnsVerified: true,
              dnsVerifiedAt: new Date(),
              sslEnabled: true, // SSL is managed by Traefik/cert-manager in platform mode
              updatedAt: new Date(),
            })
            .where(eq(domainMappings.id, id));

          this.logger.log(
            `DNS verified for custom domain (platform mode): ${domain.domain} -> ${expectedIp}`,
          );

          return {
            success: true,
            verified: true,
            domain: domain.domain,
            resolvedIps,
            alternateDomain,
            alternateDomainVerified: false, // Will be verified when SSL is requested
          };
        } else {
          return {
            success: false,
            verified: false,
            domain: domain.domain,
            resolvedIps,
            error: `Domain resolves to ${resolvedIps.join(', ')} but should point to ${expectedIp}. Update your A record.`,
            alternateDomain,
          };
        }
      }

      // Self-hosted mode: Try to reach the health check endpoint on the domain
      // This confirms nginx is serving traffic for this domain
      const healthCheckUrl = `http://${domain.domain}/.well-known/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(healthCheckUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          // Domain is reachable and nginx is serving it
          await db
            .update(domainMappings)
            .set({
              dnsVerified: true,
              dnsVerifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(domainMappings.id, id));

          this.logger.log(`DNS verified for custom domain: ${domain.domain}`);

          // Also check alternate domain
          const alternateStatus = alternateDomain
            ? await this.checkAlternateDomainDns(alternateDomain)
            : null;

          return {
            success: true,
            verified: true,
            domain: domain.domain,
            resolvedIps,
            alternateDomain,
            alternateDomainVerified: alternateStatus?.verified ?? false,
            alternateDomainIps: alternateStatus?.resolvedIps,
            alternateDomainError: alternateStatus?.error,
            alternateDomainDnsInstructions: alternateStatus?.dnsInstructions,
          };
        } else {
          return {
            success: true,
            verified: false,
            domain: domain.domain,
            resolvedIps,
            error: `Domain resolves to ${resolvedIps.join(', ')} but health check failed (status ${response.status}). The domain may be pointing to a different server.`,
            alternateDomain,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeout);
        const errorName = (fetchError as Error).name;

        if (errorName === 'AbortError') {
          return {
            success: false,
            verified: false,
            domain: domain.domain,
            resolvedIps,
            error: `Connection to ${domain.domain} timed out. The domain may be pointing to a different server.`,
            alternateDomain,
          };
        }

        return {
          success: true,
          verified: false,
          domain: domain.domain,
          resolvedIps,
          error: `Domain resolves to ${resolvedIps.join(', ')} but could not connect. Make sure the A record points to this server's IP.`,
          alternateDomain,
        };
      }
    } catch (error) {
      this.logger.warn(`DNS verification failed for ${domain.domain}: ${error}`);

      return {
        success: false,
        verified: false,
        domain: domain.domain,
        error: 'DNS verification failed. Please try again.',
        alternateDomain,
      };
    }
  }

  /**
   * Get the platform's external IP address.
   * In platform mode, this is determined by resolving the base domain.
   * Used for DNS setup instructions for custom domains.
   */
  async getPlatformIp(): Promise<string | null> {
    // First check if explicitly configured
    const configuredIp = this.configService.get<string>('PLATFORM_IP');
    if (configuredIp) {
      return configuredIp;
    }

    // Otherwise, resolve the base domain to get the IP
    const baseDomain = this.configService.get<string>('PRIMARY_DOMAIN');
    if (!baseDomain) {
      this.logger.warn('PRIMARY_DOMAIN not configured, cannot determine platform IP');
      return null;
    }

    try {
      const ips = await dns.resolve4(baseDomain);
      if (ips.length > 0) {
        this.logger.log(`Resolved platform IP from ${baseDomain}: ${ips[0]}`);
        return ips[0];
      }
    } catch (error) {
      this.logger.error(`Failed to resolve platform IP from ${baseDomain}: ${error}`);
    }

    return null;
  }

  /**
   * Check if an alternate domain (www/non-www) resolves to this server.
   * Used to determine if we can include it in the SSL certificate.
   */
  private async checkAlternateDomainDns(alternateDomain: string): Promise<{
    verified: boolean;
    resolvedIps?: string[];
    error?: string;
    dnsInstructions?: {
      recordType: string;
      host: string;
      value: string;
      note: string;
    };
  }> {
    // Determine if this is an apex domain (needs A record) or www (can use CNAME)
    const isApexDomain = !alternateDomain.startsWith('www.');

    try {
      // Check if DNS resolves
      let resolvedIps: string[] = [];
      try {
        resolvedIps = await dns.resolve4(alternateDomain);
        this.logger.log(`DNS lookup for alternate ${alternateDomain}: ${resolvedIps.join(', ')}`);
      } catch (dnsError) {
        const errCode = (dnsError as NodeJS.ErrnoException).code;
        if (errCode === 'ENODATA' || errCode === 'ENOTFOUND') {
          // Get server IP for instructions
          const serverIp = process.env.SERVER_IP || '<your-server-ip>';

          return {
            verified: false,
            error: isApexDomain
              ? `No DNS record found for ${alternateDomain}. Add an A record to enable HTTPS redirects.`
              : `No DNS record found for ${alternateDomain}. Add a CNAME or A record to enable HTTPS redirects.`,
            dnsInstructions: isApexDomain
              ? {
                  recordType: 'A',
                  host: '@',
                  value: serverIp,
                  note: 'Use @ or leave blank for the apex/root domain. CNAME records are not allowed on apex domains.',
                }
              : {
                  recordType: 'CNAME',
                  host: 'www',
                  value: process.env.PRIMARY_DOMAIN || '<your-primary-domain>',
                  note: 'Or use an A record pointing to your server IP.',
                },
          };
        }
        throw dnsError;
      }

      // Try health check
      const healthCheckUrl = `http://${alternateDomain}/.well-known/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(healthCheckUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          return { verified: true, resolvedIps };
        }
        return {
          verified: false,
          resolvedIps,
          error: `Domain resolves to ${resolvedIps.join(', ')} but is not pointing to this server.`,
        };
      } catch {
        clearTimeout(timeout);
        return {
          verified: false,
          resolvedIps,
          error: `Domain resolves to ${resolvedIps.join(', ')} but could not connect. Ensure it points to this server.`,
        };
      }
    } catch (error) {
      this.logger.warn(`Alternate domain DNS check failed for ${alternateDomain}: ${error}`);
      return {
        verified: false,
        error: 'DNS check failed. Please try again.',
      };
    }
  }

  // =====================
  // SSL Helper Methods
  // =====================

  private async enableDomainSsl(id: string, expiresAt?: Date) {
    const domain = await this.findOneById(id);

    // Update database
    await db
      .update(domainMappings)
      .set({
        sslEnabled: true,
        sslExpiresAt: expiresAt || null,
        updatedAt: new Date(),
      })
      .where(eq(domainMappings.id, id));

    // Regenerate nginx config with SSL
    const updatedDomain = { ...domain, sslEnabled: true };
    let config: string;

    // Handle redirect domains separately
    if (domain.domainType === 'redirect') {
      config = await this.nginxConfigService.generateRedirectDomainConfig({
        id: domain.id,
        domain: domain.domain,
        redirectTarget: domain.redirectTarget!,
        sslEnabled: true,
      });
    } else {
      // Non-redirect domains require a project
      if (!domain.projectId) {
        throw new Error(`Cannot enable SSL for domain ${domain.domain} - no projectId`);
      }

      const project = await this.projectsService.getProjectById(domain.projectId);

      // Get nginx proxy rules with authTransform for this domain
      const proxyRules = await this.getNginxProxyRulesForDomain(domain.projectId, domain.alias);

      config = await this.nginxConfigService.generateConfig(updatedDomain, project, proxyRules);
    }

    const { tempPath, finalPath } = await this.nginxConfigService.writeConfigFile(id, config);
    await this.nginxReloadService.validateAndReload(tempPath, finalPath);

    this.logger.log(`Enabled SSL for domain: ${domain.domain}`);
  }

  private async enableSslForAllSubdomains() {
    // Get all subdomains without SSL enabled
    const subdomains = await db
      .select()
      .from(domainMappings)
      .where(and(eq(domainMappings.domainType, 'subdomain'), eq(domainMappings.sslEnabled, false)));

    // Enable SSL for each
    for (const domain of subdomains) {
      try {
        await this.enableDomainSsl(domain.id);
      } catch (error) {
        this.logger.warn(`Failed to enable SSL for domain ${domain.domain}: ${error}`);
      }
    }

    this.logger.log(`Enabled SSL for ${subdomains.length} subdomains`);
  }

  private async findOneById(id: string) {
    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, id))
      .limit(1);

    if (!domainMapping) {
      throw new NotFoundException(`Domain mapping with ID ${id} not found`);
    }

    return domainMapping;
  }

  private validatePath(path: string) {
    if (!path.startsWith('/')) {
      throw new ConflictException('Path must start with /');
    }

    if (path.includes('..')) {
      throw new ConflictException('Path cannot contain ..');
    }

    if (path.includes('//')) {
      throw new ConflictException('Path cannot contain //');
    }
  }
}
