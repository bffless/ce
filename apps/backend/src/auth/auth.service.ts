import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users, User } from '../db/schema';
import Session from 'supertokens-node/recipe/session';

@Injectable()
export class AuthService {
  /**
   * Create a new user in the database
   * @param email - User's email address
   * @param role - User's role (admin, user, or member)
   * @param userId - Optional user ID (if provided, uses this instead of generating)
   *                 Used to sync with SuperTokens user ID for unified ID strategy
   */
  async createUser(email: string, role: 'admin' | 'user' | 'member' = 'member', userId?: string) {
    const [user] = await db
      .insert(users)
      .values({
        ...(userId && { id: userId }),
        email,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return user;
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user || null;
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId: string, role: 'admin' | 'user') {
    const [updatedUser] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    return updatedUser;
  }

  /**
   * Get user info from SuperTokens session
   */
  async getUserFromSession(sessionHandle: string) {
    try {
      const sessionInfo = await Session.getSessionInformation(sessionHandle);
      if (!sessionInfo) {
        return null;
      }
      return this.getUserByEmail(sessionInfo.userId);
    } catch (error) {
      return null;
    }
  }

  /**
   * Sign out user by revoking session
   */
  async signOut(sessionHandle: string) {
    try {
      await Session.revokeSession(sessionHandle);
      return true;
    } catch (error) {
      return false;
    }
  }
}
