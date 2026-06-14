import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

/**
 * Project secrets are named, encrypted values (e.g. third-party API tokens like
 * a Hugging Face access token) that pipelines can reference as `secrets.<NAME>`.
 *
 * Semantics (GitHub-style):
 * - Values are AES-256-GCM encrypted at rest (same scheme as AI service tokens).
 * - The plaintext value is NEVER returned by any API once saved — only the name
 *   and metadata are listed. Setting a secret again overwrites (rotates) it.
 * - Decryption happens only at pipeline runtime, and the decrypted value is
 *   redacted from debug logs and pipeline responses.
 */
export const projectSecrets = pgTable(
  'project_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Secret name used in expressions as `secrets.<name>`.
     * Constrained to uppercase letters, digits and underscores by the API
     * layer (e.g. HF_TOKEN). Unique per project.
     */
    name: varchar('name', { length: 100 }).notNull(),

    /**
     * Encrypted secret value. Wire format from the encryption helper:
     * `<ivHex>:<authTagHex>:<ciphertextHex>`.
     */
    encryptedValue: text('encrypted_value').notNull(),

    /**
     * User ID that created/last set this secret (for auditing). Nullable to
     * tolerate keys created by automation without a user context.
     */
    createdBy: varchar('created_by', { length: 255 }),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('project_secrets_project_name_unique').on(table.projectId, table.name),
    index('project_secrets_project_id_idx').on(table.projectId),
  ],
);

/**
 * Relations for project secrets
 */
export const projectSecretsRelations = relations(projectSecrets, ({ one }) => ({
  project: one(projects, {
    fields: [projectSecrets.projectId],
    references: [projects.id],
  }),
}));

export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type NewProjectSecret = typeof projectSecrets.$inferInsert;
