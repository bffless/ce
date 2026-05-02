import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  projectPermissions,
  projectGroupPermissions,
  userGroupMembers,
  users,
  userGroups,
  projects,
  domainMappings,
} from '../db/schema';
import { RequiredRole } from '../domains/visibility.service';

export type ProjectRole = 'owner' | 'admin' | 'contributor' | 'viewer' | 'guest';

/**
 * Rich shape returned by `listUserProjectMemberships` for the "My Sites" hub.
 * Distinct from `listUserProjects` (which returns bare project IDs) — this one
 * carries everything the central account UI needs to render a project card
 * without further per-project lookups.
 */
export interface MyProjectMembership {
  projectId: string;
  /** Display name (falls back to `name` when `displayName` is unset). */
  projectName: string;
  /** `${owner}/${name}` — best stable identifier we have for URL building. */
  projectSlug: string;
  /**
   * Best public URL for this project — primary domain mapping if one is
   * marked `isPrimary`, else first active custom domain, else first active
   * subdomain. Null when the project has no active domain mappings (a
   * synthesized workspace subdomain may still exist outside the DB; the UI
   * decides how to render).
   */
  primaryUrl: string | null;
  role: ProjectRole;
  /** ISO timestamp of when this user's membership was granted. */
  joinedAt: string;
  /**
   * Email of the project's owner (the unique `role='owner'` row in
   * `project_permissions`). Null when no owner exists yet — should not happen
   * in steady state but is possible mid-transfer or if the owner was deleted.
   */
  ownerEmail: string | null;
}

type DomainMappingRow = typeof domainMappings.$inferSelect;

function pickPrimaryUrl(rows: DomainMappingRow[]): string | null {
  if (rows.length === 0) return null;
  const score = (r: DomainMappingRow): number => {
    let s = 0;
    if (r.isPrimary) s += 100;
    if (r.domainType === 'custom') s += 10;
    else if (r.domainType === 'subdomain') s += 5;
    return s;
  };
  const best = [...rows].sort((a, b) => score(b) - score(a))[0];
  const scheme = best.sslEnabled ? 'https' : 'http';
  return `${scheme}://${best.domain}`;
}

@Injectable()
export class PermissionsService {
  /**
   * Get user's effective role on a project
   * Checks direct user permission first, then group permissions
   * Returns highest role from all sources
   */
  async getUserProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
    // 1. Check direct user permission
    const [directPermission] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      )
      .limit(1);

    if (directPermission) {
      return directPermission.role as ProjectRole;
    }

    // 2. Check group permissions
    const groupPermissions = await db
      .select({ role: projectGroupPermissions.role })
      .from(projectGroupPermissions)
      .innerJoin(userGroupMembers, eq(projectGroupPermissions.groupId, userGroupMembers.groupId))
      .where(
        and(eq(projectGroupPermissions.projectId, projectId), eq(userGroupMembers.userId, userId)),
      );

    if (groupPermissions.length === 0) {
      return null; // No access
    }

    // 3. Return highest role from groups
    const roles = groupPermissions.map((p) => p.role);
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('contributor')) return 'contributor';
    if (roles.includes('viewer')) return 'viewer';
    if (roles.includes('guest')) return 'guest';

    return null;
  }

  /**
   * Check if user has at least the required role on a project
   */
  async hasProjectAccess(
    userId: string,
    projectId: string,
    requiredRole: ProjectRole,
  ): Promise<boolean> {
    const userRole = await this.getUserProjectRole(userId, projectId);
    if (!userRole) return false;

    const roleHierarchy: Record<ProjectRole, number> = {
      owner: 4,
      admin: 3,
      contributor: 2,
      viewer: 1,
      guest: 0,
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  }

  /**
   * Enforce only the api-key project scope (no role check). Use this on paths
   * where role authorization is already handled elsewhere (e.g. controller-level
   * @Roles('admin')) and we just need to make sure a project-scoped api-key can
   * only operate on its declared project.
   *
   * Throws ForbiddenException when the api-key is scoped to a different project.
   * No-op for session auth (`undefined`) and global api-keys (`null`).
   */
  enforceApiKeyProjectScope(
    apiKeyProjectId: string | null | undefined,
    projectId: string,
  ): void {
    if (apiKeyProjectId !== undefined && apiKeyProjectId !== null && apiKeyProjectId !== projectId) {
      throw new ForbiddenException('API key is not authorized for this project');
    }
  }

  /**
   * Authorize a request to operate on `projectId`. Throws ForbiddenException on denial.
   *
   * Resolution order is load-bearing:
   *   1. Project-scoped API keys are enforced first, before any role shortcut. A
   *      super-admin user whose API key was minted with `projectId = X` cannot
   *      reach project Y through that key.
   *   2. System admins bypass per-project role checks (only after the api-key
   *      scope check above has passed).
   *   3. Otherwise, look up the user's effective project role and compare to
   *      the required role.
   *
   * @param apiKeyProjectId — `undefined` means session auth (no api-key context),
   *   `null` means a global (unscoped) api-key, a string means a project-scoped key.
   */
  async requireProjectAccess(
    projectId: string,
    userId: string,
    userRole: string | undefined,
    requiredRole: Exclude<ProjectRole, 'guest'> = 'contributor',
    apiKeyProjectId?: string | null,
  ): Promise<void> {
    if (apiKeyProjectId !== undefined && apiKeyProjectId !== null) {
      if (apiKeyProjectId !== projectId) {
        throw new ForbiddenException('API key is not authorized for this project');
      }
      return;
    }

    if (userRole === 'admin') {
      return;
    }

    const role = await this.getUserProjectRole(userId, projectId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const roleHierarchy: Record<ProjectRole, number> = {
      owner: 4,
      admin: 3,
      contributor: 2,
      viewer: 1,
      guest: 0,
    };

    if (roleHierarchy[role] < roleHierarchy[requiredRole]) {
      throw new ForbiddenException(`This action requires ${requiredRole} role or higher`);
    }
  }

  /**
   * Check if a user's project role meets the required access control role
   * Used for private content access control (different from project permission checks)
   *
   * @param userRole - The user's role on the project (null if no access)
   * @param requiredRole - The minimum role required for access
   * @returns true if user meets the requirement
   */
  meetsRoleRequirement(userRole: ProjectRole | null, requiredRole: RequiredRole): boolean {
    // 'authenticated' means any logged-in user with any role on the project
    // Including null role means they're authenticated but have no project-specific role
    if (requiredRole === 'authenticated') {
      // For 'authenticated', we just need them to be logged in (checked elsewhere)
      // but if they have a role, that's fine too
      return true;
    }

    // For specific roles, user must have at least that role level
    if (!userRole) {
      return false;
    }

    const roleHierarchy: Record<string, number> = {
      guest: 0,
      viewer: 1,
      contributor: 2,
      admin: 3,
      owner: 4,
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  }

  /**
   * List all projects a user has access to (via direct permission or groups)
   */
  async listUserProjects(userId: string, minRole?: ProjectRole): Promise<string[]> {
    // Get direct permissions
    const directPerms = await db
      .select({ projectId: projectPermissions.projectId, role: projectPermissions.role })
      .from(projectPermissions)
      .where(eq(projectPermissions.userId, userId));

    // Get group permissions
    const groupPerms = await db
      .select({
        projectId: projectGroupPermissions.projectId,
        role: projectGroupPermissions.role,
      })
      .from(projectGroupPermissions)
      .innerJoin(userGroupMembers, eq(projectGroupPermissions.groupId, userGroupMembers.groupId))
      .where(eq(userGroupMembers.userId, userId));

    // Combine and get unique project IDs with highest role
    const projectRoleMap = new Map<string, ProjectRole>();

    const roleHierarchy: Record<string, number> = {
      owner: 4,
      admin: 3,
      contributor: 2,
      viewer: 1,
    };

    for (const perm of [...directPerms, ...groupPerms]) {
      const existingRole = projectRoleMap.get(perm.projectId);
      if (!existingRole || roleHierarchy[perm.role] > roleHierarchy[existingRole]) {
        projectRoleMap.set(perm.projectId, perm.role as ProjectRole);
      }
    }

    // Filter by minimum role if specified
    if (minRole) {
      const minLevel = roleHierarchy[minRole];
      return Array.from(projectRoleMap.entries())
        .filter(([, role]) => roleHierarchy[role] >= minLevel)
        .map(([projectId]) => projectId);
    }

    return Array.from(projectRoleMap.keys());
  }

  /**
   * List a user's project memberships with everything the "My Sites" admin
   * page needs: display name, best public URL, role, joined-at, owner email.
   *
   * Aggregates direct memberships (`project_permissions`) and group-derived
   * memberships (`project_group_permissions` via `user_group_members`),
   * keeping the highest role per project. Per-project secondary lookups
   * (project row, domain mappings, owner email) are batched with `inArray`
   * so the cost is O(N) round-trips, not O(N × per-project queries).
   */
  async listUserProjectMemberships(userId: string): Promise<MyProjectMembership[]> {
    const directRows = await db
      .select({
        projectId: projectPermissions.projectId,
        role: projectPermissions.role,
        grantedAt: projectPermissions.grantedAt,
      })
      .from(projectPermissions)
      .where(eq(projectPermissions.userId, userId));

    const groupRows = await db
      .select({
        projectId: projectGroupPermissions.projectId,
        role: projectGroupPermissions.role,
        grantedAt: projectGroupPermissions.grantedAt,
      })
      .from(projectGroupPermissions)
      .innerJoin(userGroupMembers, eq(projectGroupPermissions.groupId, userGroupMembers.groupId))
      .where(eq(userGroupMembers.userId, userId));

    const roleHierarchy: Record<ProjectRole, number> = {
      owner: 4,
      admin: 3,
      contributor: 2,
      viewer: 1,
      guest: 0,
    };

    const aggregated = new Map<string, { role: ProjectRole; grantedAt: Date }>();
    for (const row of [...directRows, ...groupRows]) {
      const role = row.role as ProjectRole;
      const existing = aggregated.get(row.projectId);
      if (!existing || roleHierarchy[role] > roleHierarchy[existing.role]) {
        aggregated.set(row.projectId, { role, grantedAt: row.grantedAt });
      }
    }

    if (aggregated.size === 0) return [];

    const projectIds = Array.from(aggregated.keys());

    const projectRows = await db
      .select()
      .from(projects)
      .where(inArray(projects.id, projectIds));

    const domainRows = await db
      .select()
      .from(domainMappings)
      .where(
        and(inArray(domainMappings.projectId, projectIds), eq(domainMappings.isActive, true)),
      );

    const ownerRows = await db
      .select({ projectId: projectPermissions.projectId, email: users.email })
      .from(projectPermissions)
      .innerJoin(users, eq(users.id, projectPermissions.userId))
      .where(
        and(
          inArray(projectPermissions.projectId, projectIds),
          eq(projectPermissions.role, 'owner'),
        ),
      );

    const ownerByProject = new Map(ownerRows.map((r) => [r.projectId, r.email]));

    const domainsByProject = new Map<string, typeof domainRows>();
    for (const dm of domainRows) {
      if (!dm.projectId) continue;
      const list = domainsByProject.get(dm.projectId) ?? [];
      list.push(dm);
      domainsByProject.set(dm.projectId, list);
    }

    const result: MyProjectMembership[] = [];
    for (const project of projectRows) {
      const membership = aggregated.get(project.id);
      if (!membership) continue;
      const projectDomains = domainsByProject.get(project.id) ?? [];
      result.push({
        projectId: project.id,
        projectName: project.displayName ?? project.name,
        projectSlug: `${project.owner}/${project.name}`,
        primaryUrl: pickPrimaryUrl(projectDomains),
        role: membership.role,
        joinedAt: membership.grantedAt.toISOString(),
        ownerEmail: ownerByProject.get(project.id) ?? null,
      });
    }

    // Stable sort: most recently joined first.
    result.sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1));
    return result;
  }

  /**
   * Grant permission to a user on a project
   */
  async grantPermission(
    projectId: string,
    userId: string,
    role: ProjectRole,
    grantedBy: string,
  ): Promise<void> {
    // Verify granter has admin+ role
    const granterRole = await this.getUserProjectRole(grantedBy, projectId);
    if (!granterRole || !['owner', 'admin'].includes(granterRole)) {
      throw new ForbiddenException('You must be an owner or admin to grant permissions');
    }

    // Cannot grant owner role (only one owner per project)
    if (role === 'owner') {
      throw new ForbiddenException('Cannot grant owner role. Use transfer ownership instead.');
    }

    await this.upsertProjectPermission(projectId, userId, role, grantedBy);
  }

  /**
   * Grant a project permission as a system action (e.g., signup auto-grant when
   * `projects.allowPublicSignup` is true, or any other code path where there's
   * no human granter to authorize the action).
   *
   * Bypasses the granter-must-be-admin check used by `grantPermission`. The
   * resulting `project_permissions.granted_by` is null, which is the audit
   * marker for system-granted memberships. Callers should be deliberate —
   * grep for `grantSystemPermission` to audit every bypass site.
   */
  async grantSystemPermission(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    if (role === 'owner') {
      throw new ForbiddenException('Cannot grant owner role via system. Use transfer ownership.');
    }

    await this.upsertProjectPermission(projectId, userId, role, null);
  }

  private async upsertProjectPermission(
    projectId: string,
    userId: string,
    role: ProjectRole,
    grantedBy: string | null,
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      )
      .limit(1);

    if (existing) {
      await db
        .update(projectPermissions)
        .set({ role, grantedBy, grantedAt: new Date() })
        .where(
          and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
        );
    } else {
      await db.insert(projectPermissions).values({
        projectId,
        userId,
        role,
        grantedBy,
      });
    }
  }

  /**
   * Revoke a project membership as a system action — used by self-serve
   * "leave site" flows where there's no human revoker authorizing the
   * removal. Mirror of `grantSystemPermission`: bypasses the
   * revoker-must-be-admin check used by `revokePermission`. Owners cannot be
   * removed this way (they must transfer ownership first); callers that
   * receive a thrown ForbiddenException for an owner should surface a
   * "transfer ownership first" message. Idempotent: throws NotFoundException
   * when no membership row exists for the (projectId, userId) pair.
   *
   * Greppable: `git grep 'revokeSystemPermission'` lists every system-revoke
   * site for audit.
   */
  async revokeSystemPermission(projectId: string, userId: string): Promise<void> {
    const [permission] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      )
      .limit(1);

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    if (permission.role === 'owner') {
      throw new ForbiddenException(
        'Cannot revoke owner permission. Use transfer ownership instead.',
      );
    }

    await db
      .delete(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      );
  }

  /**
   * Revoke permission from a user on a project
   */
  async revokePermission(projectId: string, userId: string, revokedBy: string): Promise<void> {
    // Verify revoker has admin+ role
    const revokerRole = await this.getUserProjectRole(revokedBy, projectId);
    if (!revokerRole || !['owner', 'admin'].includes(revokerRole)) {
      throw new ForbiddenException('You must be an owner or admin to revoke permissions');
    }

    // Get the permission to revoke
    const [permission] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      )
      .limit(1);

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    // Cannot revoke owner permission
    if (permission.role === 'owner') {
      throw new ForbiddenException(
        'Cannot revoke owner permission. Use transfer ownership instead.',
      );
    }

    await db
      .delete(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      );
  }

  /**
   * Grant permission to a group on a project
   */
  async grantGroupPermission(
    projectId: string,
    groupId: string,
    role: Exclude<ProjectRole, 'owner'>,
    grantedBy: string,
  ): Promise<void> {
    // Verify granter has admin+ role
    const granterRole = await this.getUserProjectRole(grantedBy, projectId);
    if (!granterRole || !['owner', 'admin'].includes(granterRole)) {
      throw new ForbiddenException('You must be an owner or admin to grant permissions');
    }

    // Check if permission already exists
    const [existing] = await db
      .select()
      .from(projectGroupPermissions)
      .where(
        and(
          eq(projectGroupPermissions.projectId, projectId),
          eq(projectGroupPermissions.groupId, groupId),
        ),
      )
      .limit(1);

    if (existing) {
      // Update existing permission
      await db
        .update(projectGroupPermissions)
        .set({ role, grantedBy, grantedAt: new Date() })
        .where(
          and(
            eq(projectGroupPermissions.projectId, projectId),
            eq(projectGroupPermissions.groupId, groupId),
          ),
        );
    } else {
      // Create new permission
      await db.insert(projectGroupPermissions).values({
        projectId,
        groupId,
        role,
        grantedBy,
      });
    }
  }

  /**
   * Revoke permission from a group on a project
   */
  async revokeGroupPermission(
    projectId: string,
    groupId: string,
    revokedBy: string,
  ): Promise<void> {
    // Verify revoker has admin+ role
    const revokerRole = await this.getUserProjectRole(revokedBy, projectId);
    if (!revokerRole || !['owner', 'admin'].includes(revokerRole)) {
      throw new ForbiddenException('You must be an owner or admin to revoke permissions');
    }

    const [permission] = await db
      .select()
      .from(projectGroupPermissions)
      .where(
        and(
          eq(projectGroupPermissions.projectId, projectId),
          eq(projectGroupPermissions.groupId, groupId),
        ),
      )
      .limit(1);

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    await db
      .delete(projectGroupPermissions)
      .where(
        and(
          eq(projectGroupPermissions.projectId, projectId),
          eq(projectGroupPermissions.groupId, groupId),
        ),
      );
  }

  /**
   * Get all user permissions for a project with user details
   */
  async getProjectUserPermissions(projectId: string): Promise<any[]> {
    const results = await db
      .select({
        id: projectPermissions.id,
        projectId: projectPermissions.projectId,
        userId: projectPermissions.userId,
        role: projectPermissions.role,
        grantedBy: projectPermissions.grantedBy,
        grantedAt: projectPermissions.grantedAt,
        user: {
          id: users.id,
          email: users.email,
          name: sql<string | null>`NULL`, // Users table doesn't have a name field yet
        },
      })
      .from(projectPermissions)
      .innerJoin(users, eq(projectPermissions.userId, users.id))
      .where(eq(projectPermissions.projectId, projectId));

    return results;
  }

  /**
   * Get all group permissions for a project with group details
   */
  async getProjectGroupPermissions(projectId: string): Promise<any[]> {
    const results = await db
      .select({
        id: projectGroupPermissions.id,
        projectId: projectGroupPermissions.projectId,
        groupId: projectGroupPermissions.groupId,
        role: projectGroupPermissions.role,
        grantedBy: projectGroupPermissions.grantedBy,
        grantedAt: projectGroupPermissions.grantedAt,
        group: {
          id: userGroups.id,
          name: userGroups.name,
          description: userGroups.description,
        },
      })
      .from(projectGroupPermissions)
      .innerJoin(userGroups, eq(projectGroupPermissions.groupId, userGroups.id))
      .where(eq(projectGroupPermissions.projectId, projectId));

    return results;
  }
}
