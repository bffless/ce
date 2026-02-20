import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, asc } from 'drizzle-orm';
import * as crypto from 'crypto';
import { db } from '../db/client';
import { proxyRules, proxyRuleSets } from '../db/schema';
import { ProxyHeaderConfig } from '../db/schema/proxy-rules.schema';
import { PermissionsService } from '../permissions/permissions.service';
import { NginxRegenerationService } from '../domains/nginx-regeneration.service';
import { EmailService } from '../email/email.service';
import { CreateProxyRuleDto, UpdateProxyRuleDto, ReorderProxyRulesDto } from './dto';

// SSRF protection - blocked hostnames
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
];

// SSRF protection - blocked IP patterns (private networks)
const BLOCKED_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // 127.0.0.0/8
  /^169\.254\./, // Link-local
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

@Injectable()
export class ProxyRulesService {
  private readonly logger = new Logger(ProxyRulesService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
    @Inject(forwardRef(() => NginxRegenerationService))
    private readonly nginxRegenerationService: NginxRegenerationService,
    private readonly emailService: EmailService,
  ) {
    // Get encryption key from environment (same as used for storage credentials)
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (encryptionKey) {
      this.ENCRYPTION_KEY = Buffer.from(encryptionKey, 'base64');
    } else {
      // Generate a key for development (in production, this should be set via env)
      this.ENCRYPTION_KEY = crypto.randomBytes(32);
      this.logger.warn(
        'No ENCRYPTION_KEY found in environment. Generated temporary key. Set ENCRYPTION_KEY in production!',
      );
    }
  }

  /**
   * Get all proxy rules for a rule set
   */
  async getRulesByRuleSetId(ruleSetId: string): Promise<(typeof proxyRules.$inferSelect)[]> {
    const rules = await db
      .select()
      .from(proxyRules)
      .where(eq(proxyRules.ruleSetId, ruleSetId))
      .orderBy(asc(proxyRules.order));

    return rules.map((rule) => this.decryptHeaderConfig(rule));
  }

  /**
   * Get effective rules for a request based on rule set resolution.
   * Resolution order:
   *   1. If alias has a proxyRuleSetId -> use that rule set
   *   2. Else if project has a defaultProxyRuleSetId -> use that rule set
   *   3. Else -> no proxy rules
   *
   * Used by the proxy middleware.
   */
  async getEffectiveRulesForRuleSet(
    ruleSetId: string | null,
  ): Promise<(typeof proxyRules.$inferSelect)[]> {
    if (!ruleSetId) {
      return [];
    }

    const rules = await db
      .select()
      .from(proxyRules)
      .where(eq(proxyRules.ruleSetId, ruleSetId))
      .orderBy(asc(proxyRules.order));

    // Filter to only enabled rules and decrypt
    return rules.filter((r) => r.isEnabled).map((rule) => this.decryptHeaderConfig(rule));
  }

  /**
   * Get a proxy rule by ID
   */
  async getRuleById(id: string): Promise<typeof proxyRules.$inferSelect | null> {
    const [rule] = await db.select().from(proxyRules).where(eq(proxyRules.id, id)).limit(1);

    if (!rule) return null;
    return this.decryptHeaderConfig(rule);
  }

  /**
   * Create a new proxy rule within a rule set
   */
  async create(
    dto: CreateProxyRuleDto,
    userId: string,
    userRole: string,
  ): Promise<typeof proxyRules.$inferSelect> {
    // Get the rule set to find the project ID for permission checks
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, dto.ruleSetId))
      .limit(1);

    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${dto.ruleSetId} not found`);
    }

    // Check project access (need contributor or higher)
    await this.checkProjectAccess(ruleSet.projectId, userId, userRole, 'contributor');

    // Validate email form handler configuration
    if (dto.proxyType === 'email_form_handler') {
      if (!dto.emailHandlerConfig?.destinationEmail) {
        throw new BadRequestException(
          'destinationEmail is required when proxyType is email_form_handler',
        );
      }
      if (!this.emailService.isConfigured()) {
        throw new BadRequestException(
          'Email service must be configured to use email_form_handler proxy type. Configure email in Settings > Email.',
        );
      }
    }

    // Validate target URL (skip for internal rewrites and email form handlers - no external request made)
    const isInternalOrEmail =
      dto.proxyType === 'internal_rewrite' ||
      dto.proxyType === 'email_form_handler' ||
      dto.internalRewrite;
    if (!isInternalOrEmail) {
      this.validateTargetUrl(dto.targetUrl);
    }

    // Check for duplicate path pattern within the rule set
    const existingRule = await this.findRuleByPattern(dto.ruleSetId, dto.pathPattern);
    if (existingRule) {
      throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
    }

    // Auto-assign order if not provided
    const order = dto.order ?? (await this.getNextOrder(dto.ruleSetId));

    // Encrypt header config if present
    const headerConfig = dto.headerConfig ? this.encryptHeaderConfig(dto.headerConfig) : null;

    const [rule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: dto.ruleSetId,
        pathPattern: dto.pathPattern,
        targetUrl: dto.targetUrl,
        stripPrefix: dto.stripPrefix ?? true,
        order,
        timeout: dto.timeout ?? 30000,
        preserveHost: dto.preserveHost ?? false,
        forwardCookies: dto.forwardCookies ?? false,
        headerConfig,
        authTransform: dto.authTransform ?? null,
        internalRewrite: dto.internalRewrite ?? false,
        proxyType: dto.proxyType ?? 'external_proxy',
        emailHandlerConfig: dto.emailHandlerConfig ?? null,
        isEnabled: dto.isEnabled ?? true,
        description: dto.description,
      })
      .returning();

    // Regenerate nginx configs for affected domains
    try {
      await this.nginxRegenerationService.regenerateForRuleSet(rule.ruleSetId);
    } catch (error) {
      // Rollback the rule creation
      await db.delete(proxyRules).where(eq(proxyRules.id, rule.id));
      throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
    }

    this.logger.log(
      `Created proxy rule: ${dto.pathPattern} -> ${dto.targetUrl} (ruleSet: ${dto.ruleSetId})`,
    );

    return this.decryptHeaderConfig(rule);
  }

  /**
   * Update a proxy rule
   */
  async update(
    id: string,
    dto: UpdateProxyRuleDto,
    userId: string,
    userRole: string,
  ): Promise<typeof proxyRules.$inferSelect> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Proxy rule ${id} not found`);
    }

    // Get project ID from rule set for permission check
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, existing.ruleSetId))
      .limit(1);

    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${existing.ruleSetId} not found`);
    }

    // Check project access
    await this.checkProjectAccess(ruleSet.projectId, userId, userRole, 'contributor');

    // Determine effective proxy type after update
    const effectiveProxyType = dto.proxyType ?? existing.proxyType ?? 'external_proxy';

    // Validate email form handler configuration
    if (effectiveProxyType === 'email_form_handler') {
      const effectiveEmailConfig = dto.emailHandlerConfig ?? existing.emailHandlerConfig;
      if (!effectiveEmailConfig?.destinationEmail) {
        throw new BadRequestException(
          'destinationEmail is required when proxyType is email_form_handler',
        );
      }
      if (!this.emailService.isConfigured()) {
        throw new BadRequestException(
          'Email service must be configured to use email_form_handler proxy type. Configure email in Settings > Email.',
        );
      }
    }

    // Validate target URL if changing (skip for internal rewrites and email form handlers)
    const willBeInternalRewrite =
      effectiveProxyType === 'internal_rewrite' ||
      effectiveProxyType === 'email_form_handler' ||
      dto.internalRewrite === true ||
      (dto.internalRewrite === undefined && existing.internalRewrite);
    if (dto.targetUrl && dto.targetUrl !== existing.targetUrl && !willBeInternalRewrite) {
      this.validateTargetUrl(dto.targetUrl);
    }

    // Check for duplicate path pattern if changing
    if (dto.pathPattern && dto.pathPattern !== existing.pathPattern) {
      const duplicate = await this.findRuleByPattern(existing.ruleSetId, dto.pathPattern);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`A rule with path pattern "${dto.pathPattern}" already exists`);
      }
    }

    // Prepare update data
    const updateData: Partial<typeof proxyRules.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.pathPattern !== undefined) updateData.pathPattern = dto.pathPattern;
    if (dto.targetUrl !== undefined) updateData.targetUrl = dto.targetUrl;
    if (dto.stripPrefix !== undefined) updateData.stripPrefix = dto.stripPrefix;
    if (dto.order !== undefined) updateData.order = dto.order;
    if (dto.timeout !== undefined) updateData.timeout = dto.timeout;
    if (dto.preserveHost !== undefined) updateData.preserveHost = dto.preserveHost;
    if (dto.forwardCookies !== undefined) updateData.forwardCookies = dto.forwardCookies;
    if (dto.internalRewrite !== undefined) updateData.internalRewrite = dto.internalRewrite;
    if (dto.proxyType !== undefined) updateData.proxyType = dto.proxyType;
    if (dto.emailHandlerConfig !== undefined) updateData.emailHandlerConfig = dto.emailHandlerConfig;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.isEnabled !== undefined) updateData.isEnabled = dto.isEnabled;

    // Handle header config separately (needs encryption)
    if (dto.headerConfig !== undefined) {
      updateData.headerConfig = dto.headerConfig
        ? this.encryptHeaderConfig(dto.headerConfig)
        : null;
    }

    // Handle authTransform
    if (dto.authTransform !== undefined) {
      updateData.authTransform = dto.authTransform;
    }

    const [updated] = await db
      .update(proxyRules)
      .set(updateData)
      .where(eq(proxyRules.id, id))
      .returning();

    // Regenerate nginx configs for affected domains
    try {
      await this.nginxRegenerationService.regenerateForRuleSet(updated.ruleSetId);
    } catch (error) {
      // Rollback the update by restoring original values
      await db
        .update(proxyRules)
        .set({
          pathPattern: existing.pathPattern,
          targetUrl: existing.targetUrl,
          stripPrefix: existing.stripPrefix,
          order: existing.order,
          timeout: existing.timeout,
          preserveHost: existing.preserveHost,
          forwardCookies: existing.forwardCookies,
          internalRewrite: existing.internalRewrite,
          proxyType: existing.proxyType,
          emailHandlerConfig: existing.emailHandlerConfig,
          description: existing.description,
          isEnabled: existing.isEnabled,
          headerConfig: existing.headerConfig,
          authTransform: existing.authTransform,
          updatedAt: existing.updatedAt,
        })
        .where(eq(proxyRules.id, id));
      throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
    }

    this.logger.log(`Updated proxy rule ${id}`);

    return this.decryptHeaderConfig(updated);
  }

  /**
   * Delete a proxy rule
   */
  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundException(`Proxy rule ${id} not found`);
    }

    // Get project ID from rule set for permission check
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, existing.ruleSetId))
      .limit(1);

    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${existing.ruleSetId} not found`);
    }

    // Check project access
    await this.checkProjectAccess(ruleSet.projectId, userId, userRole, 'contributor');

    // Store ruleSetId before deletion for regeneration
    const ruleSetId = existing.ruleSetId;

    await db.delete(proxyRules).where(eq(proxyRules.id, id));

    // Regenerate nginx configs for affected domains
    try {
      await this.nginxRegenerationService.regenerateForRuleSet(ruleSetId);
    } catch (error) {
      // Rollback by re-inserting the deleted rule
      await db.insert(proxyRules).values({
        id: existing.id,
        ruleSetId: existing.ruleSetId,
        pathPattern: existing.pathPattern,
        targetUrl: existing.targetUrl,
        stripPrefix: existing.stripPrefix,
        order: existing.order,
        timeout: existing.timeout,
        preserveHost: existing.preserveHost,
        forwardCookies: existing.forwardCookies,
        internalRewrite: existing.internalRewrite,
        proxyType: existing.proxyType,
        emailHandlerConfig: existing.emailHandlerConfig,
        description: existing.description,
        isEnabled: existing.isEnabled,
        headerConfig: existing.headerConfig,
        authTransform: existing.authTransform,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      });
      throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
    }

    this.logger.log(`Deleted proxy rule ${id}`);
  }

  /**
   * Reorder proxy rules within a rule set
   */
  async reorder(
    ruleSetId: string,
    dto: ReorderProxyRulesDto,
    userId: string,
    userRole: string,
  ): Promise<(typeof proxyRules.$inferSelect)[]> {
    // Get rule set for permission check
    const [ruleSet] = await db
      .select()
      .from(proxyRuleSets)
      .where(eq(proxyRuleSets.id, ruleSetId))
      .limit(1);

    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${ruleSetId} not found`);
    }

    // Check project access
    await this.checkProjectAccess(ruleSet.projectId, userId, userRole, 'contributor');

    // Verify all rules belong to the rule set
    const existingRules = await db
      .select()
      .from(proxyRules)
      .where(eq(proxyRules.ruleSetId, ruleSetId));

    const existingIds = new Set(existingRules.map((r) => r.id));
    for (const id of dto.ruleIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(`Rule ${id} does not belong to this rule set`);
      }
    }

    // Store original order for rollback
    const originalOrders = new Map(existingRules.map((r) => [r.id, r.order]));

    // Update order for each rule
    for (let i = 0; i < dto.ruleIds.length; i++) {
      await db
        .update(proxyRules)
        .set({ order: i, updatedAt: new Date() })
        .where(eq(proxyRules.id, dto.ruleIds[i]));
    }

    // Regenerate nginx configs for affected domains
    try {
      await this.nginxRegenerationService.regenerateForRuleSet(ruleSetId);
    } catch (error) {
      // Rollback by restoring original order
      for (const [id, order] of originalOrders) {
        await db.update(proxyRules).set({ order }).where(eq(proxyRules.id, id));
      }
      throw new ConflictException(`Failed to regenerate nginx config: ${error.message}`);
    }

    // Return updated rules
    const updated = await db
      .select()
      .from(proxyRules)
      .where(eq(proxyRules.ruleSetId, ruleSetId))
      .orderBy(asc(proxyRules.order));

    return updated.map((rule) => this.decryptHeaderConfig(rule));
  }

  // ==================== Helper Methods ====================

  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'contributor',
  ): Promise<void> {
    // Admin users have access to all projects
    if (userRole === 'admin') {
      return;
    }

    // Check project permissions
    const role = await this.permissionsService.getUserProjectRole(userId, projectId);

    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Check if user has required role level
    const roleHierarchy = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
    const userLevel = roleHierarchy[role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(`This action requires ${requiredRole} role or higher`);
    }
  }

  private async findById(id: string) {
    const [rule] = await db.select().from(proxyRules).where(eq(proxyRules.id, id)).limit(1);

    return rule || null;
  }

  private async findRuleByPattern(ruleSetId: string, pattern: string) {
    const rules = await db.select().from(proxyRules).where(eq(proxyRules.ruleSetId, ruleSetId));

    return rules.find((r) => r.pathPattern === pattern) || null;
  }

  private async getNextOrder(ruleSetId: string): Promise<number> {
    const rules = await db
      .select({ order: proxyRules.order })
      .from(proxyRules)
      .where(eq(proxyRules.ruleSetId, ruleSetId))
      .orderBy(asc(proxyRules.order));

    if (rules.length === 0) return 0;
    return Math.max(...rules.map((r) => r.order)) + 1;
  }

  /**
   * Validate target URL for SSRF protection
   */
  private validateTargetUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL format');
    }

    const hostname = parsed.hostname.toLowerCase();

    // Allow HTTPS for any URL, or HTTP for internal services (K8s services, localhost)
    if (parsed.protocol === 'https:') {
      // HTTPS is allowed
    } else if (parsed.protocol === 'http:') {
      // HTTP allowed for internal K8s services (*.svc or *.svc.cluster.local)
      // and localhost/127.0.0.1 for same-pod sidecar communication
      const isInternalK8s =
        hostname.endsWith('.svc') || hostname.endsWith('.svc.cluster.local');
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      if (!isInternalK8s && !isLocalhost) {
        throw new BadRequestException(
          'Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost)',
        );
      }
    } else {
      throw new BadRequestException('Target URL must use HTTP or HTTPS protocol');
    }

    // Check blocked hosts (skip localhost since we allow it for same-pod sidecar)
    const isLocalhostTarget = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isLocalhostTarget && BLOCKED_HOSTS.includes(hostname)) {
      throw new BadRequestException('Target URL cannot point to internal services');
    }

    // Check IP patterns (skip localhost since we allow it for same-pod sidecar)
    if (!isLocalhostTarget) {
      for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(hostname)) {
          throw new BadRequestException('Target URL cannot point to internal IP ranges');
        }
      }
    }

    // TODO: DNS resolution check for additional SSRF protection
    // This would resolve the hostname and check if it points to internal IPs
  }

  /**
   * Encrypt sensitive header values
   */
  private encryptHeaderConfig(config: ProxyHeaderConfig): ProxyHeaderConfig {
    if (!config.add) return config;

    const encrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.add)) {
      encrypted[key] = this.encryptData(value);
    }

    return {
      ...config,
      add: encrypted,
    };
  }

  /**
   * Decrypt sensitive header values
   */
  private decryptHeaderConfig(
    rule: typeof proxyRules.$inferSelect,
  ): typeof proxyRules.$inferSelect {
    if (!rule.headerConfig?.add) return rule;

    const decrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(rule.headerConfig.add)) {
      try {
        decrypted[key] = this.decryptData(value);
      } catch {
        // If decryption fails, return as-is (might be already decrypted in dev)
        decrypted[key] = value;
      }
    }

    return {
      ...rule,
      headerConfig: {
        ...rule.headerConfig,
        add: decrypted,
      },
    };
  }

  /**
   * Encrypt sensitive data
   */
  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine iv, authTag, and encrypted data
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  private decryptData(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
