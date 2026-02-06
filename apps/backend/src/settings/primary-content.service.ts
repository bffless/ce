import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { projects, deploymentAliases } from '../db/schema';
import { DomainsService } from '../domains/domains.service';

export interface PrimaryContentConfig {
  enabled: boolean;
  projectId: string | null;
  projectOwner?: string;
  projectName?: string;
  alias: string | null;
  path: string | null;
  wwwEnabled: boolean;
  wwwBehavior: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
  isSpa: boolean;
  updatedAt: Date;
  domainMappingId?: string;
}

export interface UpdatePrimaryContentDto {
  enabled?: boolean;
  projectId?: string | null;
  alias?: string | null;
  path?: string | null;
  wwwEnabled?: boolean;
  wwwBehavior?: 'redirect-to-www' | 'redirect-to-root' | 'serve-both';
  isSpa?: boolean;
}

/**
 * Service for managing primary domain content configuration.
 * Delegates to DomainsService using a domain mapping with isPrimary=true.
 */
@Injectable()
export class PrimaryContentService {
  private readonly logger = new Logger(PrimaryContentService.name);

  constructor(private readonly domainsService: DomainsService) {}

  async getConfig(): Promise<PrimaryContentConfig> {
    const primaryDomain = await this.domainsService.getPrimaryDomain();

    if (primaryDomain) {
      // Primary domains always have a projectId (can't be redirect domains)
      if (!primaryDomain.projectId) {
        throw new Error('Primary domain has no projectId - this should not happen');
      }

      // Get project details
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, primaryDomain.projectId))
        .limit(1);

      // wwwEnabled is true when wwwBehavior is set, false when null
      const wwwEnabled = primaryDomain.wwwBehavior !== null;
      const wwwBehavior = wwwEnabled
        ? (primaryDomain.wwwBehavior as 'redirect-to-www' | 'redirect-to-root' | 'serve-both')
        : 'redirect-to-www';

      return {
        enabled: primaryDomain.isActive,
        projectId: primaryDomain.projectId,
        projectOwner: project?.owner,
        projectName: project?.name,
        alias: primaryDomain.alias,
        path: primaryDomain.path,
        wwwEnabled,
        wwwBehavior,
        isSpa: primaryDomain.isSpa,
        updatedAt: primaryDomain.updatedAt,
        domainMappingId: primaryDomain.id,
      };
    }

    // Return default config if no primary domain mapping exists
    return {
      enabled: false,
      projectId: null,
      alias: null,
      path: null,
      wwwEnabled: true,
      wwwBehavior: 'redirect-to-www',
      isSpa: false,
      updatedAt: new Date(),
    };
  }

  async updateConfig(dto: UpdatePrimaryContentDto, userId: string): Promise<PrimaryContentConfig> {
    const willBeEnabled = dto.enabled ?? false;
    const projectId = dto.projectId;
    const alias = dto.alias;

    // Validate alias exists if enabling primary content
    if (willBeEnabled && projectId && alias) {
      const [existingAlias] = await db
        .select()
        .from(deploymentAliases)
        .where(and(eq(deploymentAliases.projectId, projectId), eq(deploymentAliases.alias, alias)))
        .limit(1);

      if (!existingAlias) {
        throw new NotFoundException(
          `Alias "${alias}" not found for this project. Deploy with this alias first.`,
        );
      }
    }

    // Validate that enabled requires projectId and alias
    if (willBeEnabled && (!projectId || !alias)) {
      throw new BadRequestException(
        'Project and alias are required when enabling primary content.',
      );
    }

    const existingPrimary = await this.domainsService.getPrimaryDomain();
    const baseDomain = process.env.PRIMARY_DOMAIN || 'localhost';

    if (existingPrimary) {
      // Check if project is changing - if so, we need to delete and recreate
      if (projectId && projectId !== existingPrimary.projectId) {
        this.logger.log(`Project changed, recreating primary domain mapping`);
        await this.domainsService.remove(existingPrimary.id, userId);
        const wwwBehavior = dto.wwwEnabled === false ? null : dto.wwwBehavior || 'redirect-to-www';
        await this.domainsService.create(
          {
            projectId,
            alias: dto.alias || 'production',
            path: dto.path || undefined,
            domain: baseDomain,
            domainType: 'subdomain',
            isSpa: dto.isSpa || false,
            isPrimary: true,
            wwwBehavior,
          },
          userId,
        );
      } else {
        // Update existing primary domain mapping
        this.logger.log(`Updating existing primary domain mapping: ${existingPrimary.id}`);
        const wwwBehavior = dto.wwwEnabled === false ? null : dto.wwwBehavior;
        await this.domainsService.update(
          existingPrimary.id,
          {
            alias: dto.alias ?? undefined,
            path: dto.path ?? undefined,
            isActive: dto.enabled,
            isSpa: dto.isSpa,
            wwwBehavior,
          },
          userId,
        );
      }
    } else if (willBeEnabled && projectId && alias) {
      // Create new primary domain mapping
      this.logger.log(`Creating new primary domain mapping for ${baseDomain}`);
      const wwwBehavior = dto.wwwEnabled === false ? null : dto.wwwBehavior || 'redirect-to-www';
      await this.domainsService.create(
        {
          projectId,
          alias,
          path: dto.path || undefined,
          domain: baseDomain,
          domainType: 'subdomain',
          isSpa: dto.isSpa || false,
          isPrimary: true,
          wwwBehavior,
        },
        userId,
      );
    }
    // If not enabling and no existing mapping, nothing to do

    return this.getConfig();
  }

  async getAvailableProjects(): Promise<
    Array<{
      id: string;
      owner: string;
      name: string;
      aliases: string[];
    }>
  > {
    const projectList = await db.select().from(projects);

    const result = await Promise.all(
      projectList.map(async (p) => {
        const aliases = await db
          .select({ alias: deploymentAliases.alias })
          .from(deploymentAliases)
          .where(eq(deploymentAliases.projectId, p.id));

        return {
          id: p.id,
          owner: p.owner,
          name: p.name,
          aliases: aliases.map((a) => a.alias),
        };
      }),
    );

    return result;
  }
}
