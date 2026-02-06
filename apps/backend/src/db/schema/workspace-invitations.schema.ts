import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Workspace invitations for inviting users by email
 *
 * Flow:
 * 1. Admin creates invitation for an email address
 * 2. System generates unique token
 * 3. User visits /invite/:token page
 * 4. User signs in or creates account via SuperTokens
 * 5. POST /api/invitations/:token/accept adds user to workspace
 */
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Email address of the invited user
    email: varchar('email', { length: 255 }).notNull(),

    // Role to assign when invitation is accepted
    role: varchar('role', { length: 32 }).notNull().default('user'),

    // Unique token for the invitation link
    token: varchar('token', { length: 255 }).notNull().unique(),

    // Who created the invitation (null if system-generated)
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),

    // When the invitation expires
    expiresAt: timestamp('expires_at').notNull(),

    // When the invitation was accepted (null if pending)
    acceptedAt: timestamp('accepted_at'),

    // ID of the user who accepted (null if pending)
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_workspace_invitations_email').on(table.email),
    index('idx_workspace_invitations_token').on(table.token),
  ],
);

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;
