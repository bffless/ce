import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { domainMappings } from './domain-mappings.schema';
import { users } from './users.schema';

export const domainRedirects = pgTable(
  'domain_redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDomain: varchar('source_domain', { length: 255 }).notNull().unique(),
    targetDomainId: uuid('target_domain_id')
      .notNull()
      .references(() => domainMappings.id, { onDelete: 'cascade' }),
    redirectType: varchar('redirect_type', { length: 10 })
      .notNull()
      .default('301')
      .$type<'301' | '302'>(),
    isActive: boolean('is_active').notNull().default(true),
    sslEnabled: boolean('ssl_enabled').notNull().default(false),
    nginxConfigPath: varchar('nginx_config_path', { length: 500 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('domain_redirects_target_domain_id_idx').on(table.targetDomainId),
    index('domain_redirects_source_domain_idx').on(table.sourceDomain),
  ],
);

export const domainRedirectsRelations = relations(domainRedirects, ({ one }) => ({
  targetDomain: one(domainMappings, {
    fields: [domainRedirects.targetDomainId],
    references: [domainMappings.id],
  }),
  creator: one(users, {
    fields: [domainRedirects.createdBy],
    references: [users.id],
  }),
}));

export type DomainRedirect = typeof domainRedirects.$inferSelect;
export type NewDomainRedirect = typeof domainRedirects.$inferInsert;
