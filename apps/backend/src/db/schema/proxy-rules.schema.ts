import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { proxyRuleSets } from './proxy-rule-sets.schema';

/**
 * Header configuration for proxy rules.
 *
 * IMPORTANT: The `add` field can contain sensitive data like API keys.
 * Values in `add` are encrypted before storage using the same encryption
 * as storage credentials (ENCRYPTION_KEY).
 */
export interface ProxyHeaderConfig {
  /** Headers to forward from the original request (default: standard safe headers) */
  forward?: string[];
  /** Headers to remove before forwarding (default: hop-by-hop + sensitive) */
  strip?: string[];
  /**
   * Headers to add to the proxied request (e.g., API keys).
   * Values are ENCRYPTED at rest for security.
   * Example: { 'X-API-Key': 'sk_live_abc123', 'Authorization': 'Bearer token' }
   */
  add?: Record<string, string>;
}

/**
 * Auth transformation configuration for nginx-level proxy rules.
 *
 * When set, the proxy rule is rendered as an nginx location block
 * instead of being handled by backend middleware. This enables
 * cookie-to-bearer token transformation at the nginx level.
 *
 * Use case: Console UI needs to proxy /api/platform/* to Control Plane
 * with the sAccessToken cookie extracted and sent as Authorization: Bearer header.
 */
export interface AuthTransformConfig {
  /**
   * Type of auth transformation:
   * - 'cookie-to-bearer': Extract cookie value, add as Bearer token in Authorization header
   */
  type: 'cookie-to-bearer';

  /**
   * Name of the cookie to extract.
   * Example: 'sAccessToken' (SuperTokens JWT cookie)
   */
  cookieName: string;
}

/**
 * Proxy rule type.
 *
 * - 'external_proxy': Forward requests to an external URL (default)
 * - 'internal_rewrite': Serve a different path from the same deployment (no HTTP request)
 * - 'email_form_handler': Capture POST form submissions and email them
 */
export type ProxyType = 'external_proxy' | 'internal_rewrite' | 'email_form_handler';

/**
 * Email handler configuration for email_form_handler proxy rules.
 *
 * When proxyType is 'email_form_handler', this config specifies how to
 * handle form submissions and send emails.
 */
export interface EmailHandlerConfig {
  /** Email address to send form submissions to (required) */
  destinationEmail: string;
  /** Subject line for the email (default: "Form Submission") */
  subject?: string;
  /** URL to redirect to after successful submission (optional) */
  successRedirect?: string;
  /** CORS origin to allow (optional, for cross-origin form submissions) */
  corsOrigin?: string;
  /** Name of a honeypot field for spam protection (optional) */
  honeypotField?: string;
  /** Form field name to use as reply-to address (optional) */
  replyToField?: string;
  /** Require authentication to submit the form (optional, default: false) */
  requireAuth?: boolean;
}

/**
 * Proxy rules table - stores reverse proxy configurations.
 *
 * Each rule belongs to a ProxyRuleSet. Rule sets can be:
 * 1. Assigned as project defaults (via projects.defaultProxyRuleSetId)
 * 2. Assigned to specific aliases (via deployment_aliases.proxyRuleSetId)
 * 3. Specified during upload for auto-preview aliases
 *
 * Resolution order:
 *   1. If alias has a proxyRuleSetId -> use rules from that rule set
 *   2. Else if project has a defaultProxyRuleSetId -> use rules from that rule set
 *   3. Else -> no proxy rules apply
 *
 * Example configuration:
 *   Rule Set "api-backend-prod":
 *     - Rule: /api/* -> https://api.example.com
 *     - Rule: /graphql -> https://graphql.example.com
 *
 *   Project "owner/repo":
 *     - defaultProxyRuleSetId: "api-backend-dev" (default for all aliases)
 *
 *   Alias "production":
 *     - proxyRuleSetId: "api-backend-prod" (override)
 *
 *   Request to /public/owner/repo/production/api/users:
 *     -> Alias has proxyRuleSetId -> uses "api-backend-prod" -> https://api.example.com/users
 *
 *   Request to /public/owner/repo/staging/api/users (no alias override):
 *     -> Falls back to project default -> uses "api-backend-dev"
 */
export const proxyRules = pgTable(
  'proxy_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The rule set this rule belongs to.
     * All rules must belong to a rule set.
     */
    ruleSetId: uuid('rule_set_id')
      .references(() => proxyRuleSets.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Path pattern to match against the request path (after owner/repo/ref prefix).
     *
     * Supported patterns:
     * - Exact: '/graphql' matches only '/graphql'
     * - Prefix: '/api/*' matches '/api/users', '/api/posts/1', etc.
     * - Suffix: '*.json' matches '/config.json', '/data.json'
     *
     * Pattern must start with '/' or '*'.
     */
    pathPattern: varchar('path_pattern', { length: 500 }).notNull(),

    /**
     * Target URL to forward matching requests to.
     *
     * Must be HTTPS. Internal IPs and localhost are blocked for security.
     *
     * Examples:
     * - 'https://api.example.com'
     * - 'https://api.example.com/v1'
     */
    targetUrl: text('target_url').notNull(),

    /**
     * Whether to remove the matched path prefix before forwarding.
     *
     * Example with pattern '/api/*' and target 'https://api.example.com':
     * - stripPrefix=true:  /api/users -> https://api.example.com/users
     * - stripPrefix=false: /api/users -> https://api.example.com/api/users
     *
     * Default: true
     */
    stripPrefix: boolean('strip_prefix').notNull().default(true),

    /**
     * Rule evaluation order. Lower numbers are evaluated first.
     * If two rules could match, the one with lower order wins.
     *
     * Default: auto-assigned (max + 1 for rule set)
     */
    order: integer('order').notNull().default(0),

    /**
     * Request timeout in milliseconds.
     *
     * Range: 1000-60000 (1-60 seconds)
     * Default: 30000 (30 seconds)
     */
    timeout: integer('timeout').notNull().default(30000),

    /**
     * Whether to preserve the original Host header when forwarding.
     *
     * - false (default): Use target URL's host (e.g., 'api.example.com')
     * - true: Forward original host (e.g., 'coverage.j5s.dev')
     *
     * Most backends expect false. Set to true if target validates Host header.
     */
    preserveHost: boolean('preserve_host').notNull().default(false),

    /**
     * Whether to forward cookies to the target.
     *
     * - false (default): Strip cookies for security (prevents credential leakage)
     * - true: Forward cookies to target (needed for session-based auth proxying)
     *
     * Only enable when proxying to trusted backends that require cookie-based auth.
     */
    forwardCookies: boolean('forward_cookies').notNull().default(false),

    /**
     * Header configuration for the proxy request.
     *
     * - forward: Headers to forward (default: safe subset)
     * - strip: Headers to remove (default: hop-by-hop + cookie)
     * - add: Headers to add (e.g., { 'X-API-Key': 'secret' }) - ENCRYPTED!
     *
     * SECURITY NOTE: The `add` field values are encrypted at rest using
     * the same ENCRYPTION_KEY as storage credentials. This allows users
     * to safely store API keys and auth tokens.
     */
    headerConfig: jsonb('header_config').$type<ProxyHeaderConfig>(),

    /**
     * Auth transformation configuration for nginx-level proxying.
     *
     * When set, this rule is rendered as an nginx location block instead
     * of being handled by backend middleware. This enables cookie-to-bearer
     * token transformation at the nginx level.
     *
     * Example: { type: 'cookie-to-bearer', cookieName: 'sAccessToken' }
     * Generates nginx config:
     *   proxy_set_header Authorization "Bearer $cookie_sAccessToken";
     */
    authTransform: jsonb('auth_transform').$type<AuthTransformConfig>(),

    /**
     * Whether this is an internal rewrite rule (no HTTP proxy request).
     *
     * When true:
     * - targetUrl is interpreted as a path within the same deployment (e.g., /environments/production.json)
     * - No HTTP request is made to an external service
     * - The request URL is rewritten and continues to normal file serving
     *
     * Use case: Serve /env.json from /environments/production.json without an HTTP round-trip.
     *
     * Default: false (normal external proxy behavior)
     *
     * @deprecated Use proxyType='internal_rewrite' instead. This field is kept for backward compatibility.
     */
    internalRewrite: boolean('internal_rewrite').notNull().default(false),

    /**
     * Type of proxy rule behavior.
     *
     * - 'external_proxy': Forward requests to an external URL (default)
     * - 'internal_rewrite': Serve a different path from the same deployment
     * - 'email_form_handler': Capture POST form submissions and email them
     *
     * Note: For backward compatibility, if proxyType is null/'external_proxy' but
     * internalRewrite is true, the rule is treated as 'internal_rewrite'.
     */
    proxyType: varchar('proxy_type', { length: 50 }).$type<ProxyType>().default('external_proxy'),

    /**
     * Configuration for email_form_handler proxy type.
     *
     * Required when proxyType is 'email_form_handler'.
     * Contains settings for email destination, subject, redirects, CORS, and spam protection.
     */
    emailHandlerConfig: jsonb('email_handler_config').$type<EmailHandlerConfig>(),

    /**
     * Whether this rule is active.
     * Disabled rules are skipped during matching.
     */
    isEnabled: boolean('is_enabled').notNull().default(true),

    /**
     * Optional description for documentation purposes.
     */
    description: text('description'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    /**
     * Each rule set can only have one rule per path pattern.
     */
    uniqueIndex('proxy_rules_rule_set_path_unique').on(table.ruleSetId, table.pathPattern),

    /**
     * Index for efficient lookup by rule set.
     */
    index('proxy_rules_rule_set_id_idx').on(table.ruleSetId),

    /**
     * Index for ordering rules within a rule set.
     */
    index('proxy_rules_rule_set_order_idx').on(table.ruleSetId, table.order),

    /**
     * Index for filtering by proxy type.
     */
    index('proxy_rules_proxy_type_idx').on(table.proxyType),
  ],
);

/**
 * Relations for proxy rules
 */
export const proxyRulesRelations = relations(proxyRules, ({ one }) => ({
  ruleSet: one(proxyRuleSets, {
    fields: [proxyRules.ruleSetId],
    references: [proxyRuleSets.id],
  }),
}));

// Type exports
export type ProxyRule = typeof proxyRules.$inferSelect;
export type NewProxyRule = typeof proxyRules.$inferInsert;
