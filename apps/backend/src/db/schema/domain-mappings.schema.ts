import { pgTable, uuid, varchar, boolean, timestamp, text, index, integer } from 'drizzle-orm/pg-core';
import { projects } from './projects.schema';
import { users } from './users.schema';

export const domainMappings = pgTable(
  'domain_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // projectId is optional for 'redirect' domain type (no project association needed)
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 255 }),
    path: varchar('path', { length: 500 }),
    domain: varchar('domain', { length: 255 }).notNull().unique(),
    domainType: varchar('domain_type', { length: 20 }).notNull(), // 'subdomain' | 'custom' | 'redirect'
    // Target domain for redirect type (e.g., 'new-brand.com')
    // Only used when domainType = 'redirect'
    redirectTarget: varchar('redirect_target', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    // Phase B5: Visibility override
    // null = inherit from alias, true = force public, false = force private
    isPublic: boolean('is_public'),
    // Access control overrides (null = inherit from alias, then project)
    // 'not_found' | 'redirect_login'
    unauthorizedBehavior: varchar('unauthorized_behavior', { length: 20 }),
    // 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner'
    requiredRole: varchar('required_role', { length: 20 }),
    sslEnabled: boolean('ssl_enabled').notNull().default(false),
    sslExpiresAt: timestamp('ssl_expires_at'),
    dnsVerified: boolean('dns_verified').notNull().default(false),
    dnsVerifiedAt: timestamp('dns_verified_at'),
    nginxConfigPath: varchar('nginx_config_path', { length: 500 }),
    // Phase B: SSL auto-renewal management
    autoRenewSsl: boolean('auto_renew_ssl').notNull().default(true),
    sslRenewedAt: timestamp('ssl_renewed_at'),
    sslRenewalStatus: varchar('ssl_renewal_status', { length: 20 }),
    sslRenewalError: text('ssl_renewal_error'),
    // Phase C: Traffic routing / sticky sessions
    stickySessionsEnabled: boolean('sticky_sessions_enabled').notNull().default(true),
    stickySessionDuration: integer('sticky_session_duration').notNull().default(86400), // 24 hours in seconds
    // SPA mode: When true, 404s fallback to index.html for client-side routing
    isSpa: boolean('is_spa').notNull().default(false),
    // Primary domain flag: Only one domain mapping can be marked as primary
    // Primary domains serve content on the workspace's root domain (PRIMARY_DOMAIN)
    isPrimary: boolean('is_primary').notNull().default(false),
    // WWW behavior: 'redirect-to-www' | 'redirect-to-root' | 'serve-both'
    // Applies to primary domains and custom domains (www/apex handling)
    // null means no www/apex redirect handling (default)
    wwwBehavior: varchar('www_behavior', { length: 20 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('domain_mappings_project_id_idx').on(table.projectId),
    index('domain_mappings_domain_idx').on(table.domain),
    index('domain_mappings_is_active_idx').on(table.isActive),
  ],
);

export type DomainMapping = typeof domainMappings.$inferSelect;
export type NewDomainMapping = typeof domainMappings.$inferInsert;
