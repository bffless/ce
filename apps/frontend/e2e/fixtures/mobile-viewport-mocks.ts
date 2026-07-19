import { Page } from '@playwright/test';

/**
 * Full-surface API mocks for the mobile viewport regression suite
 * (mobile-viewport.spec.ts).
 *
 * Unlike the per-page helpers in helpers/mock-api.ts, this module mocks the
 * ENTIRE /api surface with one catch-all route so every admin page renders
 * with realistic data and no backend. Fixtures deliberately include
 * stress-test values (long unbroken domain names, long emails, long URLs,
 * long alias/schema names) because unbreakable strings are the most common
 * cause of horizontal overflow regressions.
 *
 * Route table semantics: first match (method + pathname regex) wins;
 * unmatched GET /api requests are fulfilled with `{}`.
 */

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

const session = {
  session: { userId: 'user-1', handle: 'sess-1' },
  user: { id: 'user-1', email: 'admin@example.com', role: 'admin' },
  emailVerified: true,
  emailVerificationRequired: false,
};

const project = {
  id: 'proj-1',
  owner: 'acme',
  name: 'webapp',
  displayName: 'Web Application',
  description: 'Main web application frontend',
  isPublic: false,
  unauthorizedBehavior: 'redirect_login',
  requiredRole: 'authenticated',
  allowPublicSignup: false,
  settings: null,
  defaultProxyRuleSetId: 'rs-1',
  defaultProxyRuleSetIds: ['rs-1'],
  createdBy: 'user-1',
  createdAt: daysAgo(120),
  updatedAt: daysAgo(1),
};

const mkDeployment = (i: number, branch: string, desc: string) => ({
  id: `dep-${i}`,
  commitSha: `${i}bc4f2a9e8d7c6b5a4938271605f4e3d2c1b0a9${i}`.slice(0, 40),
  shortSha: `${i}bc4f2a`,
  branch,
  description: desc,
  deployedAt: daysAgo(i * 0.7),
  fileCount: 120 + i,
  totalSize: 9_100_000 + i * 250_000,
  isPublic: i % 2 === 0,
});
const deployments = [
  mkDeployment(1, 'main', 'feat(frontend): support multiple conditional terminal response branches (#502)'),
  mkDeployment(2, 'main', 'fix(pipelines): make the `ne` filter null-safe (IS DISTINCT FROM) (#501)'),
  mkDeployment(3, 'feat/pipeline-primitives', 'wip: schema editor validation for deeply nested field groups'),
  mkDeployment(4, 'main', 'chore: release main (#499)'),
  mkDeployment(5, 'fix/mobile-overflow', 'fix long unbroken words causing layout issues'),
];

const aliases = [
  { id: 'al-1', name: 'production', commitSha: deployments[0].commitSha, shortSha: '1bc4f2a', branch: 'main', deploymentId: 'dep-1', createdAt: daysAgo(90), updatedAt: daysAgo(1), isPublic: true, isAutoPreview: false, proxyRuleSetIds: ['rs-1'] },
  { id: 'al-2', name: 'staging', commitSha: deployments[1].commitSha, shortSha: '2bc4f2a', branch: 'main', deploymentId: 'dep-2', createdAt: daysAgo(60), updatedAt: daysAgo(2), isPublic: false, isAutoPreview: false, proxyRuleSetIds: ['rs-1'] },
  { id: 'al-3', name: 'pr-42-preview-long-alias-name', commitSha: deployments[2].commitSha, shortSha: '3bc4f2a', branch: 'feat/pipeline-primitives', deploymentId: 'dep-3', createdAt: daysAgo(3), updatedAt: daysAgo(3), isPublic: false, isAutoPreview: true, basePath: 'pr-42', proxyRuleSetIds: [] },
  { id: 'al-4', name: 'www', commitSha: deployments[0].commitSha, shortSha: '1bc4f2a', branch: 'main', deploymentId: 'dep-1', createdAt: daysAgo(30), updatedAt: daysAgo(1), isPublic: true, isAutoPreview: false, proxyRuleSetIds: ['rs-1'] },
];

const schemaFeedback = {
  id: 'schema-1',
  projectId: 'proj-1',
  name: 'feedback',
  version: 1,
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'message', type: 'text', required: true },
    { name: 'rating', type: 'number', required: false, default: 5 },
    { name: 'createdFrom', type: 'string', required: false },
  ],
  createdAt: daysAgo(2),
  updatedAt: daysAgo(1),
  recordCount: 3,
};
const schemas = [
  schemaFeedback,
  { id: 'schema-2', projectId: 'proj-1', name: 'chat-conversations', version: 2, fields: [{ name: 'title', type: 'string', required: true }, { name: 'userId', type: 'string', required: true }], createdAt: daysAgo(40), updatedAt: daysAgo(5), recordCount: 128 },
  { id: 'schema-3', projectId: 'proj-1', name: 'upload-manifests-with-a-long-name', version: 1, fields: [{ name: 'key', type: 'string', required: true }, { name: 'size', type: 'number', required: true }, { name: 'meta', type: 'json', required: false }], createdAt: daysAgo(10), updatedAt: daysAgo(10), recordCount: 57 },
];

const records = [
  { id: 'rec-1', projectId: 'proj-1', schemaId: 'schema-1', alias: null, version: 1, data: { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Love the new deploy flow! The alias switcher saved us during the launch. One thing: the mobile admin overflows horizontally on my phone.', rating: 5, createdFrom: 'production' }, createdBy: 'guest-8f2', createdAt: daysAgo(0.4), updatedAt: daysAgo(0.4) },
  { id: 'rec-2', projectId: 'proj-1', schemaId: 'schema-1', alias: 'production', version: 1, data: { name: 'Grace Hopper', email: 'grace.hopper+verylongemailaddress@example-company-domain.com', message: 'Short note.', rating: 4, createdFrom: 'production' }, createdBy: null, createdAt: daysAgo(1.3), updatedAt: daysAgo(1.3) },
  { id: 'rec-3', projectId: 'proj-1', schemaId: 'schema-1', alias: 'staging', version: 1, data: { name: 'ThisIsAnUnbrokenSuperLongUserNameFromAnAPIWithoutSpaces', email: 't@e.io', message: 'https://very-long-url.example.com/deep/path/segment/that/never/wraps/because/it/has/no/spaces/at/all', rating: 3, createdFrom: 'staging' }, createdBy: 'user-1', createdAt: daysAgo(2.1), updatedAt: daysAgo(2.1) },
];

const ruleSets = [
  { id: 'rs-1', projectId: 'proj-1', name: 'api', description: 'Primary API rule set for the production alias', environment: 'production', source: { repo: 'acme/webapp', path: 'proxy-rules/api.json', syncedAt: daysAgo(2) }, createdAt: daysAgo(80), updatedAt: daysAgo(2) },
  { id: 'rs-2', projectId: 'proj-1', name: 'staging-experiments', description: null, environment: 'staging', source: null, createdAt: daysAgo(20), updatedAt: daysAgo(4) },
];
const mkRule = (i: number, pathPattern: string, method: string | null, targetUrl: string, proxyType: string, desc: string | null) => ({
  id: `rule-${i}`,
  ruleSetId: 'rs-1',
  pathPattern,
  method,
  methods: method ? [method] : null,
  targetUrl,
  stripPrefix: true,
  order: i,
  timeout: 30000,
  preserveHost: false,
  forwardCookies: true,
  headerConfig: null,
  authTransform: null,
  internalRewrite: false,
  proxyType,
  emailHandlerConfig: null,
  pipelineConfig: proxyType === 'pipeline' ? { handlers: [{ type: 'data_insert' }, { type: 'respond' }] } : null,
  isEnabled: i !== 3,
  debugEnabled: i === 2,
  description: desc,
  createdAt: daysAgo(30),
  updatedAt: daysAgo(2),
});
const rules = [
  mkRule(1, '/api/contact', 'POST', 'pipeline://contact-form', 'pipeline', 'Contact form intake with email notification'),
  mkRule(2, '/api/comments/*', null, 'pipeline://comments', 'pipeline', 'Live comment wall data table access'),
  mkRule(3, '/api/search', 'GET', 'https://search-backend.internal.example.com:9200/indexes/site/query', 'http', null),
  mkRule(4, '/api/chat', 'POST', 'pipeline://ai-chat-streaming-with-long-target-name', 'pipeline', 'Streaming AI chat completion relay'),
];

const users = [
  { id: 'user-1', email: 'admin@example.com', role: 'admin', disabled: false, disabledAt: null, disabledBy: null, createdAt: daysAgo(300), updatedAt: daysAgo(1) },
  { id: 'user-2', email: 'grace.hopper+team@example-company-domain.com', role: 'member', disabled: false, disabledAt: null, disabledBy: null, createdAt: daysAgo(120), updatedAt: daysAgo(9) },
  { id: 'user-3', email: 'former.employee@example.com', role: 'member', disabled: true, disabledAt: daysAgo(30), disabledBy: 'user-1', createdAt: daysAgo(200), updatedAt: daysAgo(30) },
];

const groups = [
  { id: 'grp-1', name: 'engineering', description: 'Full write access to app repos', createdBy: 'user-1', createdAt: daysAgo(100), updatedAt: daysAgo(10) },
  { id: 'grp-2', name: 'contractors-read-only', description: null, createdBy: 'user-1', createdAt: daysAgo(50), updatedAt: daysAgo(50) },
];

const repositoriesMine = {
  total: 3,
  repositories: [
    { id: 'proj-1', owner: 'acme', name: 'webapp', permissionType: 'owner', role: 'admin' },
    { id: 'proj-2', owner: 'acme', name: 'docs', permissionType: 'direct', role: 'write' },
    { id: 'proj-3', owner: 'acme', name: 'internal-analytics-service', permissionType: 'group', role: 'read' },
  ],
};
const repositoriesFeed = {
  page: 1,
  limit: 10,
  total: 3,
  repositories: [
    { id: 'proj-1', owner: 'acme', name: 'webapp', displayName: 'Web Application', description: 'Main web application frontend', isPublic: false, permissionType: 'owner', role: 'admin', stats: { deploymentCount: 42, storageBytes: 9_100_000, storageMB: 9.1, lastDeployedAt: daysAgo(0.5) }, createdAt: daysAgo(120), updatedAt: daysAgo(0.5) },
    { id: 'proj-2', owner: 'acme', name: 'docs', displayName: 'Documentation', description: 'API documentation and guides', isPublic: true, permissionType: 'direct', role: 'write', stats: { deploymentCount: 15, storageBytes: 10_485_760, storageMB: 10, lastDeployedAt: daysAgo(12) }, createdAt: daysAgo(300), updatedAt: daysAgo(12) },
    { id: 'proj-3', owner: 'acme', name: 'internal-analytics-service', displayName: null, description: null, isPublic: false, permissionType: 'group', role: 'read', stats: { deploymentCount: 8, storageBytes: 5_242_880, storageMB: 5, lastDeployedAt: daysAgo(40) }, createdAt: daysAgo(220), updatedAt: daysAgo(40) },
  ],
};

const stats = {
  repository: 'acme/webapp',
  totalDeployments: 42,
  totalStorageBytes: 9_100_000,
  totalStorageMB: 9.1,
  lastDeployedAt: daysAgo(0.5),
  branchCount: 3,
  aliasCount: 4,
  isPublic: false,
};

const refs = {
  aliases: aliases.map((a) => ({ name: a.name, commitSha: a.commitSha, updatedAt: a.updatedAt, isAutoPreview: a.isAutoPreview })),
  branches: [
    { name: 'main', latestCommit: deployments[0].commitSha, latestDeployedAt: daysAgo(0.5), fileCount: 121 },
    { name: 'feat/pipeline-primitives', latestCommit: deployments[2].commitSha, latestDeployedAt: daysAgo(2), fileCount: 118 },
    { name: 'fix/mobile-overflow-on-schema-detail-page', latestCommit: deployments[4].commitSha, latestDeployedAt: daysAgo(3.5), fileCount: 119 },
  ],
  recentCommits: deployments.map((d) => ({ sha: d.commitSha, shortSha: d.shortSha, branch: d.branch, description: d.description, deployedAt: d.deployedAt, parentShas: [] })),
  pagination: { hasMore: false, total: 5 },
};

const schedules = [
  { id: 'sched-1', projectId: 'proj-1', name: 'nightly-cleanup', targetProxyRuleId: 'rule-2', cronExpression: '0 3 * * *', timezone: 'America/New_York', enabled: true, lastRunAt: daysAgo(0.3), nextRunAt: daysAgo(-0.7), createdAt: daysAgo(30), updatedAt: daysAgo(0.3) },
  { id: 'sched-2', projectId: 'proj-1', name: 'weekly-digest-email-with-long-name', targetProxyRuleId: 'rule-1', cronExpression: '0 9 * * MON', timezone: 'UTC', enabled: false, lastError: 'Timeout of 30000ms exceeded while calling pipeline handler chain', createdAt: daysAgo(60), updatedAt: daysAgo(7) },
];

const domains = [
  { id: 'dom-1', projectId: 'proj-1', alias: 'production', domain: 'example.dev', domainType: 'custom', isActive: true, isPublic: true, isSpa: true, isPrimary: true, wwwBehavior: 'redirect-to-www', sslEnabled: true, sslExpiresAt: daysAgo(-60), dnsVerified: true, dnsVerifiedAt: daysAgo(90), createdBy: 'user-1', createdAt: daysAgo(90), updatedAt: daysAgo(1) },
  // Long unbroken domain: regression stress for min-content overflow (grid/truncate)
  { id: 'dom-2', projectId: 'proj-1', alias: 'staging', domain: 'staging.example-with-a-long-subdomain.dev', domainType: 'custom', isActive: true, isPublic: false, isSpa: true, isPrimary: false, sslEnabled: false, dnsVerified: false, createdBy: 'user-1', createdAt: daysAgo(10), updatedAt: daysAgo(10) },
];

type RouteEntry = [method: string, pathPattern: RegExp, body: unknown];

const ROUTES: RouteEntry[] = [
  ['GET', /\/api\/auth\/session$/, session],
  ['GET', /\/api\/auth\/oauth\/providers/, { providers: [] }],
  ['GET', /\/api\/auth\/registration-status/, { registrationEnabled: true, allowPublicSignups: false, emailPasswordEnabled: true, requireTosAcceptance: false, tosUrl: '' }],
  ['GET', /\/api\/auth\/me\/login-methods/, { hasPassword: true }],
  ['GET', /\/api\/setup\/status/, { isSetupComplete: true, hasAdminUser: true, storageProvider: 'minio', emailConfigured: true }],
  ['GET', /\/api\/settings\/branding\/public/, { siteName: 'BFFless', hasHeaderLogo: false, hasAuthLogo: false }],
  ['GET', /\/api\/settings\/branding/, { siteName: 'BFFless', headerLogoKey: null, authLogoKey: null }],
  ['GET', /\/api\/settings\/primary-content\/projects/, { projects: [{ id: 'proj-1', owner: 'acme', name: 'webapp', aliases: ['production', 'staging', 'www'] }] }],
  ['GET', /\/api\/settings\/primary-content/, { enabled: true, projectId: 'proj-1', projectOwner: 'acme', projectName: 'webapp', alias: 'production', path: null, wwwEnabled: true, wwwBehavior: 'redirect-to-www', isSpa: true, updatedAt: daysAgo(5) }],
  ['GET', /\/api\/settings\/telemetry/, { enabled: true, forcedOffByEnv: false, lastSentAt: daysAgo(0.2) }],
  ['GET', /\/api\/feature-flags\/client/, { flags: {} }],
  ['GET', /\/api\/feature-flags\/grouped/, { groups: [] }],
  ['GET', /\/api\/feature-flags$/, { flags: [] }],
  ['GET', /\/api\/aliases\/[^/]+\/[^/]+\/visibility/, { projectId: 'proj-1', alias: 'production', effectiveVisibility: 'public', source: 'alias', aliasOverride: true, projectVisibility: false, effectiveUnauthorizedBehavior: 'redirect_login', effectiveRequiredRole: 'authenticated' }],
  ['GET', /\/api\/proxy-rules\/[^/]+\/logs\/count/, { count: 12 }],
  ['GET', /\/api\/proxy-rules\/[^/]+\/logs/, { logs: [], total: 0 }],
  ['GET', /\/api\/repositories\/mine/, repositoriesMine],
  ['GET', /\/api\/repositories\/feed/, repositoriesFeed],
  ['GET', /\/api\/repo\/[^/]+\/[^/]+\/stats/, stats],
  ['GET', /\/api\/repo\/[^/]+\/[^/]+\/refs/, refs],
  ['GET', /\/api\/repo\/[^/]+\/[^/]+\/deployments/, { repository: 'acme/webapp', page: 1, limit: 20, total: 5, deployments }],
  ['GET', /\/api\/repo\/[^/]+\/[^/]+\/aliases$/, { repository: 'acme/webapp', aliases }],
  ['GET', /\/api\/projects\/[^/]+\/[^/]+\/permissions\/users/, { users: [] }],
  ['GET', /\/api\/projects\/[^/]+\/[^/]+\/permissions\/groups/, { groups: [] }],
  ['GET', /\/api\/projects\/[^/]+\/[^/]+\/permissions$/, { userPermissions: [{ id: 'perm-1', projectId: 'proj-1', userId: 'user-1', role: 'owner', grantedBy: null, grantedAt: daysAgo(120), user: { id: 'user-1', email: 'admin@example.com', name: null, role: 'admin' } }], groupPermissions: [] }],
  ['GET', /\/api\/projects\/[^/]+\/[^/]+$/, project],
  ['GET', /\/api\/projects$/, { projects: [project] }],
  ['GET', /\/api\/pipeline-schemas\/schema-\d+\/data/, { records, total: 3, page: 1, pageSize: 20, totalPages: 1 }],
  ['GET', /\/api\/pipeline-schemas\/schema-1/, schemaFeedback],
  ['GET', /\/api\/pipeline-schemas\/schema-2/, schemas[1]],
  ['GET', /\/api\/pipeline-schemas\/schema-3/, schemas[2]],
  ['GET', /\/api\/pipeline-schemas/, { schemas }],
  ['GET', /\/api\/proxy-rule-sets\/project\//, { ruleSets }],
  ['GET', /\/api\/proxy-rule-sets\/rs-1/, { ...ruleSets[0], rules }],
  ['GET', /\/api\/proxy-rule-sets\/rs-2/, { ...ruleSets[1], rules: [] }],
  ['GET', /\/api\/pipeline-schedules\/projects\/[^/]+\/schedules/, { data: schedules }],
  ['GET', /\/api\/pipeline-schedules\/projects\/[^/]+\/rules/, { data: [{ id: 'rule-1', name: 'Contact form intake', ruleSetId: 'rs-1', ruleSetName: 'api' }, { id: 'rule-2', name: 'Comments', ruleSetId: 'rs-1', ruleSetName: 'api' }] }],
  ['GET', /\/api\/users/, { data: users, meta: { page: 1, limit: 20, total: 3, totalPages: 1 } }],
  ['GET', /\/api\/user-groups/, { groups }],
  ['GET', /\/api\/groups/, { groups }],
  ['GET', /\/api\/domains\/ssl\/wildcard\/status/, { exists: true, isSelfSigned: false, issuer: "Let's Encrypt", expiresAt: daysAgo(-60), daysUntilExpiry: 60, isExpiringSoon: false }],
  ['GET', /\/api\/domains\/config/, { primaryDomain: 'example.dev', wildcardEnabled: true }],
  ['GET', /\/api\/domains\/[^/]+\/traffic$/, { domainId: 'dom-1', weights: [], stickySessionDuration: 86400 }],
  ['GET', /\/api\/domains\/[^/]+\/traffic\/rules/, []],
  ['GET', /\/api\/domains\/[^/]+\/redirects/, []],
  ['GET', /\/api\/domains\/[^/]+\/path-redirects/, []],
  ['GET', /\/api\/domains$/, domains],
  ['GET', /\/api\/domains/, { domains: [] }],
  ['GET', /\/api\/me\/projects/, { projects: [] }],
  ['GET', /\/api\/api-keys/, { apiKeys: [] }],
  ['GET', /\/api\/storage/, { totalBytes: 9_100_000, totalMB: 9.1 }],
  ['GET', /\/api\/traffic/, { data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } }],
];

/**
 * Mock the entire /api surface. Unmatched GET requests resolve to `{}` so
 * pages never hang on a real network call.
 */
export async function mockAllApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const hit = ROUTES.find(([method, pattern]) => method === request.method() && pattern.test(url.pathname));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(hit ? hit[2] : {}),
    });
  });
}
