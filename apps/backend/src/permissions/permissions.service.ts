import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  projectPermissions,
  projectGroupPermissions,
  userGroupMembers,
  users,
  userGroups,
} from '../db/schema';
import { RequiredRole } from '../domains/visibility.service';

export type ProjectRole = 'owner' | 'admin' | 'contributor' | 'viewer';

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
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
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

    // Check if permission already exists
    const [existing] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
      )
      .limit(1);

    if (existing) {
      // Update existing permission
      await db
        .update(projectPermissions)
        .set({ role, grantedBy, grantedAt: new Date() })
        .where(
          and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId)),
        );
    } else {
      // Create new permission
      await db.insert(projectPermissions).values({
        projectId,
        userId,
        role,
        grantedBy,
      });
    }
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
