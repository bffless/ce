import { Injectable, Logger } from '@nestjs/common';
import { eq, and, or } from 'drizzle-orm';
import { db } from '../db/client';
import { domainMappings, deploymentAliases, projects, DomainMapping } from '../db/schema';

/**
 * Access control types for private content
 */
export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

/**
 * Full access control information resolved from cascade
 */
export interface AccessControlInfo {
  isPublic: boolean;
  unauthorizedBehavior: UnauthorizedBehavior;
  requiredRole: RequiredRole;
  source: 'domain' | 'alias' | 'project';
}

/**
 * Phase B5: Visibility Resolution Service
 *
 * Handles visibility cascade resolution for domains and aliases.
 *
 * Resolution priority:
 * 1. Domain override (if domain.isPublic is not null) → Use domain's setting
 * 2. Alias override (if alias.isPublic is not null) → Use alias's setting
 * 3. Project default → Use project.isPublic
 *
 * The tri-state nullable boolean:
 * - null = inherit from parent
 * - true = force public (override parent)
 * - false = force private (override parent)
 */
@Injectable()
export class VisibilityService {
  private readonly logger = new Logger(VisibilityService.name);

  /**
   * Resolve effective visibility for a domain mapping
   * Priority: domain override → alias setting → project setting
   *
   * @param domainMapping - The domain mapping to check visibility for
   * @returns true if public, false if private
   */
  async resolveVisibility(domainMapping: DomainMapping): Promise<boolean> {
    // Redirect domains are always public (they just redirect to another domain)
    if (domainMapping.domainType === 'redirect') {
      this.logger.debug(`Domain ${domainMapping.domain} visibility: public (redirect domain)`);
      return true;
    }

    // 1. Domain-level override takes precedence
    if (domainMapping.isPublic !== null) {
      this.logger.debug(
        `Domain ${domainMapping.domain} visibility from domain override: ${domainMapping.isPublic}`,
      );
      return domainMapping.isPublic;
    }

    // Non-redirect domains require a projectId
    if (!domainMapping.projectId) {
      this.logger.warn(`Domain ${domainMapping.domain} has no projectId, defaulting to public`);
      return true;
    }

    // 2. Check alias visibility if domain has an alias
    if (domainMapping.alias) {
      const aliasVisibility = await this.getAliasVisibility(
        domainMapping.projectId,
        domainMapping.alias,
      );

      if (aliasVisibility !== null) {
        this.logger.debug(
          `Domain ${domainMapping.domain} visibility from alias '${domainMapping.alias}': ${aliasVisibility}`,
        );
        return aliasVisibility;
      }
    }

    // 3. Fall back to project visibility
    const projectVisibility = await this.getProjectVisibility(domainMapping.projectId);
    this.logger.debug(
      `Domain ${domainMapping.domain} visibility from project: ${projectVisibility}`,
    );
    return projectVisibility;
  }

  /**
   * Resolve effective visibility for an alias
   * Priority: alias setting → project setting
   *
   * @param projectId - The project UUID
   * @param aliasName - The alias name (e.g., 'production', 'staging')
   * @returns true if public, false if private
   */
  async resolveAliasVisibility(projectId: string, aliasName: string): Promise<boolean> {
    // 1. Check alias-level override
    const aliasVisibility = await this.getAliasVisibility(projectId, aliasName);

    if (aliasVisibility !== null) {
      this.logger.debug(`Alias '${aliasName}' visibility from alias override: ${aliasVisibility}`);
      return aliasVisibility;
    }

    // 2. Fall back to project visibility
    const projectVisibility = await this.getProjectVisibility(projectId);
    this.logger.debug(`Alias '${aliasName}' visibility from project: ${projectVisibility}`);
    return projectVisibility;
  }

  /**
   * Get visibility info with source for debugging/UI
   *
   * @param domainMapping - The domain mapping to check
   * @returns Object with effective visibility and source information
   */
  async getVisibilityInfo(domainMapping: DomainMapping): Promise<{
    effectiveVisibility: boolean;
    source: 'domain' | 'alias' | 'project';
    domainOverride: boolean | null;
    aliasVisibility: boolean | null;
    projectVisibility: boolean;
  }> {
    // Redirect domains are always public
    if (domainMapping.domainType === 'redirect' || !domainMapping.projectId) {
      return {
        effectiveVisibility: true,
        source: 'domain',
        domainOverride: true,
        aliasVisibility: null,
        projectVisibility: true,
      };
    }

    // Get all visibility values
    const aliasVisibility = domainMapping.alias
      ? await this.getAliasVisibility(domainMapping.projectId, domainMapping.alias)
      : null;
    const projectVisibility = await this.getProjectVisibility(domainMapping.projectId);

    // Determine effective visibility and source
    let effectiveVisibility: boolean;
    let source: 'domain' | 'alias' | 'project';

    if (domainMapping.isPublic !== null) {
      effectiveVisibility = domainMapping.isPublic;
      source = 'domain';
    } else if (aliasVisibility !== null) {
      effectiveVisibility = aliasVisibility;
      source = 'alias';
    } else {
      effectiveVisibility = projectVisibility;
      source = 'project';
    }

    return {
      effectiveVisibility,
      source,
      domainOverride: domainMapping.isPublic,
      aliasVisibility,
      projectVisibility,
    };
  }

  /**
   * Get the isPublic value for an alias (without inheritance)
   * Returns null if alias doesn't exist or has no override
   *
   * @param projectId - The project UUID
   * @param aliasName - The alias name
   * @returns The alias's isPublic value or null if not set/alias not found
   */
  private async getAliasVisibility(projectId: string, aliasName: string): Promise<boolean | null> {
    const [alias] = await db
      .select({ isPublic: deploymentAliases.isPublic })
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
      )
      .limit(1);

    return alias?.isPublic ?? null;
  }

  /**
   * Get the project's isPublic value
   *
   * @param projectId - The project UUID
   * @returns The project's isPublic value (always boolean, defaults to false)
   */
  private async getProjectVisibility(projectId: string): Promise<boolean> {
    const [project] = await db
      .select({ isPublic: projects.isPublic })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return project?.isPublic ?? false;
  }

  /**
   * Resolve visibility for a domain by its domain name string
   * Useful for nginx config generation and public controller checks
   *
   * @param domain - The full domain string (e.g., 'coverage.example.com')
   * @returns true if public, false if private, null if domain not found
   */
  async resolveVisibilityByDomain(domain: string): Promise<boolean | null> {
    const alternate = domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;

    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(or(eq(domainMappings.domain, domain), eq(domainMappings.domain, alternate)))
      .limit(1);

    if (!domainMapping) {
      return null;
    }

    return this.resolveVisibility(domainMapping);
  }

  /**
   * Resolve full access control settings for a domain mapping
   * Priority: domain → alias → project (most specific wins)
   *
   * @param domainMapping - The domain mapping to check
   * @returns Full access control info including visibility, behavior, and required role
   */
  async resolveAccessControl(domainMapping: DomainMapping): Promise<AccessControlInfo> {
    // Get visibility (using existing method)
    const isPublic = await this.resolveVisibility(domainMapping);

    // Redirect domains are always public with default access control
    if (domainMapping.domainType === 'redirect' || !domainMapping.projectId) {
      return {
        isPublic: true,
        unauthorizedBehavior: 'not_found',
        requiredRole: 'authenticated',
        source: 'domain',
      };
    }

    // For access control fields, we need to check cascade
    // Domain → Alias → Project
    const projectSettings = await this.getProjectAccessControl(domainMapping.projectId);

    // Check domain-level overrides first
    if (domainMapping.unauthorizedBehavior !== null || domainMapping.requiredRole !== null) {
      return {
        isPublic,
        unauthorizedBehavior:
          (domainMapping.unauthorizedBehavior as UnauthorizedBehavior) ??
          projectSettings.unauthorizedBehavior,
        requiredRole: (domainMapping.requiredRole as RequiredRole) ?? projectSettings.requiredRole,
        source: 'domain',
      };
    }

    // Check alias-level overrides
    if (domainMapping.alias) {
      const aliasSettings = await this.getAliasAccessControl(
        domainMapping.projectId,
        domainMapping.alias,
      );

      if (aliasSettings.unauthorizedBehavior !== null || aliasSettings.requiredRole !== null) {
        return {
          isPublic,
          unauthorizedBehavior:
            aliasSettings.unauthorizedBehavior ?? projectSettings.unauthorizedBehavior,
          requiredRole: aliasSettings.requiredRole ?? projectSettings.requiredRole,
          source: 'alias',
        };
      }
    }

    // Fall back to project settings
    return {
      isPublic,
      unauthorizedBehavior: projectSettings.unauthorizedBehavior,
      requiredRole: projectSettings.requiredRole,
      source: 'project',
    };
  }

  /**
   * Resolve access control for a domain by its domain name string
   *
   * @param domain - The full domain string
   * @returns Access control info or null if domain not found
   */
  async resolveAccessControlByDomain(domain: string): Promise<AccessControlInfo | null> {
    const alternate = domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;

    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(or(eq(domainMappings.domain, domain), eq(domainMappings.domain, alternate)))
      .limit(1);

    if (!domainMapping) {
      return null;
    }

    return this.resolveAccessControl(domainMapping);
  }

  /**
   * Resolve access control for an alias
   * Priority: alias → project
   *
   * @param projectId - The project UUID
   * @param aliasName - The alias name
   * @returns Access control info
   */
  async resolveAccessControlForAlias(
    projectId: string,
    aliasName: string,
  ): Promise<AccessControlInfo> {
    // Get visibility
    const isPublic = await this.resolveAliasVisibility(projectId, aliasName);

    // Get project settings as fallback
    const projectSettings = await this.getProjectAccessControl(projectId);

    // Check alias-level overrides
    const aliasSettings = await this.getAliasAccessControl(projectId, aliasName);

    if (aliasSettings.unauthorizedBehavior !== null || aliasSettings.requiredRole !== null) {
      return {
        isPublic,
        unauthorizedBehavior:
          aliasSettings.unauthorizedBehavior ?? projectSettings.unauthorizedBehavior,
        requiredRole: aliasSettings.requiredRole ?? projectSettings.requiredRole,
        source: 'alias',
      };
    }

    // Fall back to project settings
    return {
      isPublic,
      unauthorizedBehavior: projectSettings.unauthorizedBehavior,
      requiredRole: projectSettings.requiredRole,
      source: 'project',
    };
  }

  /**
   * Get access control settings for an alias (without inheritance)
   */
  private async getAliasAccessControl(
    projectId: string,
    aliasName: string,
  ): Promise<{
    unauthorizedBehavior: UnauthorizedBehavior | null;
    requiredRole: RequiredRole | null;
  }> {
    const [alias] = await db
      .select({
        unauthorizedBehavior: deploymentAliases.unauthorizedBehavior,
        requiredRole: deploymentAliases.requiredRole,
      })
      .from(deploymentAliases)
      .where(
        and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, aliasName)),
      )
      .limit(1);

    return {
      unauthorizedBehavior: (alias?.unauthorizedBehavior as UnauthorizedBehavior) ?? null,
      requiredRole: (alias?.requiredRole as RequiredRole) ?? null,
    };
  }

  /**
   * Get access control settings for a project
   */
  private async getProjectAccessControl(projectId: string): Promise<{
    unauthorizedBehavior: UnauthorizedBehavior;
    requiredRole: RequiredRole;
  }> {
    const [project] = await db
      .select({
        unauthorizedBehavior: projects.unauthorizedBehavior,
        requiredRole: projects.requiredRole,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return {
      unauthorizedBehavior: (project?.unauthorizedBehavior as UnauthorizedBehavior) ?? 'not_found',
      requiredRole: (project?.requiredRole as RequiredRole) ?? 'authenticated',
    };
  }
}
