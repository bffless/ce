import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { projectInviteLinks, projectPermissions, projects } from '../db/schema';

@Injectable()
export class ProjectInviteLinksService {
  private readonly logger = new Logger(ProjectInviteLinksService.name);

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  async create(
    projectId: string,
    role: string,
    createdBy: string,
    label?: string,
    expiresAt?: Date,
    maxUses?: number,
  ) {
    const token = this.generateToken();

    const [link] = await db
      .insert(projectInviteLinks)
      .values({
        projectId,
        token,
        role,
        label: label || null,
        expiresAt: expiresAt || null,
        maxUses: maxUses || null,
        createdBy,
      })
      .returning();

    return link;
  }

  async listByProject(projectId: string) {
    return db
      .select()
      .from(projectInviteLinks)
      .where(eq(projectInviteLinks.projectId, projectId))
      .orderBy(projectInviteLinks.createdAt);
  }

  async getById(id: string) {
    const [link] = await db
      .select()
      .from(projectInviteLinks)
      .where(eq(projectInviteLinks.id, id))
      .limit(1);
    return link || null;
  }

  async update(
    id: string,
    updates: {
      label?: string | null;
      isActive?: boolean;
      expiresAt?: Date | null;
      maxUses?: number | null;
    },
  ) {
    const [link] = await db
      .update(projectInviteLinks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projectInviteLinks.id, id))
      .returning();

    if (!link) {
      throw new NotFoundException('Invite link not found');
    }

    return link;
  }

  async delete(id: string) {
    const [link] = await db
      .delete(projectInviteLinks)
      .where(eq(projectInviteLinks.id, id))
      .returning();

    if (!link) {
      throw new NotFoundException('Invite link not found');
    }

    return link;
  }

  /**
   * Validate a token without consuming it.
   * Used by the public validate endpoint to show project info on signup page.
   */
  async validate(token: string) {
    const [link] = await db
      .select({
        id: projectInviteLinks.id,
        projectId: projectInviteLinks.projectId,
        role: projectInviteLinks.role,
        isActive: projectInviteLinks.isActive,
        expiresAt: projectInviteLinks.expiresAt,
        maxUses: projectInviteLinks.maxUses,
        useCount: projectInviteLinks.useCount,
        projectName: projects.name,
        projectOwner: projects.owner,
      })
      .from(projectInviteLinks)
      .innerJoin(projects, eq(projectInviteLinks.projectId, projects.id))
      .where(eq(projectInviteLinks.token, token))
      .limit(1);

    if (!link) {
      return { valid: false };
    }

    if (!link.isActive) {
      return { valid: false };
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return { valid: false };
    }

    if (link.maxUses !== null && link.useCount >= link.maxUses) {
      return { valid: false };
    }

    return {
      valid: true,
      projectName: link.projectName,
      projectOwner: link.projectOwner,
      role: link.role,
    };
  }

  /**
   * Redeem an invite link for a user after successful auth.
   * Validates the token, checks if user already has access, grants role,
   * and increments the use count.
   */
  async redeemForUser(token: string, userId: string): Promise<boolean> {
    // Look up the invite link
    const [link] = await db
      .select()
      .from(projectInviteLinks)
      .where(eq(projectInviteLinks.token, token))
      .limit(1);

    if (!link) {
      this.logger.warn(`Project invite link not found: ${token.substring(0, 8)}...`);
      return false;
    }

    if (!link.isActive) {
      this.logger.warn(`Project invite link is inactive: ${link.id}`);
      return false;
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      this.logger.warn(`Project invite link expired: ${link.id}`);
      return false;
    }

    if (link.maxUses !== null && link.useCount >= link.maxUses) {
      this.logger.warn(`Project invite link max uses reached: ${link.id}`);
      return false;
    }

    // Check if user already has a role on this project
    const [existingPermission] = await db
      .select()
      .from(projectPermissions)
      .where(
        and(
          eq(projectPermissions.projectId, link.projectId),
          eq(projectPermissions.userId, userId),
        ),
      )
      .limit(1);

    if (existingPermission) {
      this.logger.log(
        `User ${userId} already has ${existingPermission.role} role on project ${link.projectId}, skipping`,
      );
      // Still count the use even if user already has access
      await db
        .update(projectInviteLinks)
        .set({
          useCount: sql`${projectInviteLinks.useCount} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectInviteLinks.id, link.id));
      return false;
    }

    // Grant the project role (direct insert, same pattern as onboarding executor)
    await db.insert(projectPermissions).values({
      projectId: link.projectId,
      userId,
      role: link.role,
      grantedBy: link.createdBy,
    });

    // Increment use count
    await db
      .update(projectInviteLinks)
      .set({
        useCount: sql`${projectInviteLinks.useCount} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectInviteLinks.id, link.id));

    this.logger.log(
      `Granted ${link.role} role to user ${userId} on project ${link.projectId} via invite link ${link.id}`,
    );

    return true;
  }
}
