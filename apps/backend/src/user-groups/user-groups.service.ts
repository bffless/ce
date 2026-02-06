import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { userGroups, userGroupMembers, users, UserGroup, UserGroupMember } from '../db/schema';

export interface UserGroupWithMembers extends UserGroup {
  members: (UserGroupMember & { user: typeof users.$inferSelect })[];
}

@Injectable()
export class UserGroupsService {
  /**
   * Create a new user group
   */
  async createGroup(
    name: string,
    description: string | null,
    createdBy: string,
  ): Promise<UserGroup> {
    const [newGroup] = await db
      .insert(userGroups)
      .values({
        name,
        description,
        createdBy,
      })
      .returning();

    return newGroup;
  }

  /**
   * Get a group by ID with all members and their user details
   */
  async getGroup(id: string): Promise<UserGroupWithMembers> {
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${id}`);
    }

    // Get all members with user details
    const members = await db
      .select({
        id: userGroupMembers.id,
        groupId: userGroupMembers.groupId,
        userId: userGroupMembers.userId,
        addedBy: userGroupMembers.addedBy,
        addedAt: userGroupMembers.addedAt,
        user: users,
      })
      .from(userGroupMembers)
      .innerJoin(users, eq(userGroupMembers.userId, users.id))
      .where(eq(userGroupMembers.groupId, id));

    return {
      ...group,
      members,
    };
  }

  /**
   * List all groups that a user belongs to or created
   */
  async listUserGroups(userId: string): Promise<UserGroup[]> {
    // Get groups the user created
    const createdGroups = await db
      .select()
      .from(userGroups)
      .where(eq(userGroups.createdBy, userId));

    // Get groups the user is a member of
    const memberGroups = await db
      .select({
        id: userGroups.id,
        name: userGroups.name,
        description: userGroups.description,
        createdBy: userGroups.createdBy,
        createdAt: userGroups.createdAt,
        updatedAt: userGroups.updatedAt,
      })
      .from(userGroupMembers)
      .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
      .where(eq(userGroupMembers.userId, userId));

    // Combine and deduplicate (user might be creator and member)
    const allGroups = [...createdGroups, ...memberGroups];
    const uniqueGroups = allGroups.filter(
      (group, index, self) => index === self.findIndex((g) => g.id === group.id),
    );

    return uniqueGroups;
  }

  /**
   * Update a group's name or description
   * Only the creator can update the group
   */
  async updateGroup(
    id: string,
    updates: Partial<Pick<UserGroup, 'name' | 'description'>>,
    requestingUserId: string,
  ): Promise<UserGroup> {
    // Check if group exists and user is the creator
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${id}`);
    }

    if (group.createdBy !== requestingUserId) {
      throw new ForbiddenException('Only the group creator can update the group');
    }

    const [updatedGroup] = await db
      .update(userGroups)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(userGroups.id, id))
      .returning();

    return updatedGroup;
  }

  /**
   * Delete a group (cascade deletes all members)
   * Only the creator can delete the group
   */
  async deleteGroup(id: string, requestingUserId: string): Promise<void> {
    // Check if group exists and user is the creator
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${id}`);
    }

    if (group.createdBy !== requestingUserId) {
      throw new ForbiddenException('Only the group creator can delete the group');
    }

    await db.delete(userGroups).where(eq(userGroups.id, id));
  }

  /**
   * Add a member to a group
   * Only the creator can add members
   */
  async addMember(groupId: string, userId: string, addedBy: string): Promise<void> {
    // Check if group exists and requesting user is the creator
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${groupId}`);
    }

    if (group.createdBy !== addedBy) {
      throw new ForbiddenException('Only the group creator can add members');
    }

    // Check if user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }

    // Check if already a member
    const [existingMember] = await db
      .select()
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)))
      .limit(1);

    if (existingMember) {
      throw new ConflictException('User is already a member of this group');
    }

    // Add member
    await db.insert(userGroupMembers).values({
      groupId,
      userId,
      addedBy,
    });
  }

  /**
   * Remove a member from a group
   * Only the creator can remove members
   */
  async removeMember(groupId: string, userId: string, requestingUserId: string): Promise<void> {
    // Check if group exists and requesting user is the creator
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${groupId}`);
    }

    if (group.createdBy !== requestingUserId) {
      throw new ForbiddenException('Only the group creator can remove members');
    }

    // Check if member exists
    const [member] = await db
      .select()
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)))
      .limit(1);

    if (!member) {
      throw new NotFoundException('User is not a member of this group');
    }

    // Remove member
    await db
      .delete(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)));
  }

  /**
   * Get all members of a group with user details
   */
  async getGroupMembers(
    groupId: string,
  ): Promise<(UserGroupMember & { user: typeof users.$inferSelect })[]> {
    // Verify group exists
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);

    if (!group) {
      throw new NotFoundException(`User group not found: ${groupId}`);
    }

    // Get all members with user details
    const members = await db
      .select({
        id: userGroupMembers.id,
        groupId: userGroupMembers.groupId,
        userId: userGroupMembers.userId,
        addedBy: userGroupMembers.addedBy,
        addedAt: userGroupMembers.addedAt,
        user: users,
      })
      .from(userGroupMembers)
      .innerJoin(users, eq(userGroupMembers.userId, users.id))
      .where(eq(userGroupMembers.groupId, groupId));

    return members;
  }
}
