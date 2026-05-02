import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { domainMappings, projects, Project } from '../db/schema';

/**
 * Resolves the Project (if any) that an inbound HTTP request belongs to,
 * based on the request hostname.
 *
 * Used by the auth surface to apply project-membership gates: signin/signup
 * endpoints check `getUserProjectRole(user, project)` to refuse cross-project
 * access when REQUIRE_PROJECT_MEMBERSHIP is enabled.
 *
 * Resolution rules:
 *   1. Admin domain (`admin.<PRIMARY_DOMAIN>`, `admin.sites.<PRIMARY_DOMAIN>`,
 *      or the value of `ADMIN_DOMAIN`) → returns null. Admin/staff workflows
 *      are workspace-scoped, not project-scoped.
 *   2. Any hostname registered in `domain_mappings` (custom domain or workspace
 *      subdomain) → returns the linked Project. Both www and non-www variants
 *      collapse to the same row, mirroring `VisibilityService.resolveAccessControlByDomain`.
 *   3. Unknown hostnames → null (no project context; auth controllers treat
 *      this as the admin-equivalent path and skip the membership check).
 */
@Injectable()
export class ProjectResolverService {
  private readonly logger = new Logger(ProjectResolverService.name);

  async resolveProjectFromRequest(req: Request): Promise<Project | null> {
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const hostname = host.split(':')[0].toLowerCase();
    if (!hostname) return null;

    if (this.isAdminDomain(hostname)) return null;

    const projectId = await this.findProjectIdForHostname(hostname);
    if (!projectId) return null;

    return this.loadProject(projectId);
  }

  private isAdminDomain(hostname: string): boolean {
    const adminDomain = process.env.ADMIN_DOMAIN;
    if (adminDomain && hostname === adminDomain.toLowerCase()) return true;

    const primary = process.env.PRIMARY_DOMAIN;
    if (!primary) return false;
    const primaryLower = primary.toLowerCase();
    return (
      hostname === `admin.${primaryLower}` ||
      hostname === `admin.sites.${primaryLower}`
    );
  }

  private async findProjectIdForHostname(hostname: string): Promise<string | null> {
    const alternate = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
    const [mapping] = await db
      .select({ projectId: domainMappings.projectId })
      .from(domainMappings)
      .where(or(eq(domainMappings.domain, hostname), eq(domainMappings.domain, alternate)))
      .limit(1);
    return mapping?.projectId ?? null;
  }

  private async loadProject(projectId: string): Promise<Project | null> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return project ?? null;
  }
}
