import { api } from './api';

export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

// WWW behavior for domain redirects
export type WwwBehavior = 'redirect-to-www' | 'redirect-to-root' | 'serve-both';

// Types matching backend DTOs
export interface DomainMapping {
  id: string;
  projectId?: string | null;
  alias?: string;
  path?: string;
  domain: string;
  domainType: 'subdomain' | 'custom' | 'redirect';
  isActive: boolean;
  // Phase B5: Visibility override (null = inherit from alias/project)
  isPublic?: boolean | null;
  // Access control overrides (null = inherit from alias/project)
  unauthorizedBehavior?: UnauthorizedBehavior | null;
  requiredRole?: RequiredRole | null;
  // SPA mode: when true, 404s fallback to index.html for client-side routing
  isSpa: boolean;
  // Primary domain flag - serves content on the base domain (e.g., example.com, www.example.com)
  isPrimary?: boolean;
  // WWW behavior for handling www/apex alternate domain
  wwwBehavior?: WwwBehavior | null;
  // Target domain for redirect domain type
  redirectTarget?: string | null;
  sslEnabled: boolean;
  sslExpiresAt?: string;
  dnsVerified: boolean;
  dnsVerifiedAt?: string;
  nginxConfigPath?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDomainDto {
  projectId?: string;
  alias?: string;
  path?: string;
  domain: string;
  domainType: 'subdomain' | 'custom' | 'redirect';
  sslEnabled?: boolean;
  /** Visibility override. Custom domains are forced to public since auth cookies don't work cross-domain. */
  isPublic?: boolean | null;
  /** Access control overrides (null = inherit from alias/project) */
  unauthorizedBehavior?: UnauthorizedBehavior | null;
  requiredRole?: RequiredRole | null;
  /** SPA mode: when true, 404s fallback to index.html for client-side routing */
  isSpa?: boolean;
  /** WWW behavior for handling www/apex alternate domain */
  wwwBehavior?: WwwBehavior | null;
  /** Target domain for redirect domain type */
  redirectTarget?: string;
}

export interface UpdateDomainDto {
  alias?: string;
  path?: string;
  isActive?: boolean;
  // Phase B5: Visibility override (null = inherit from alias/project)
  isPublic?: boolean | null;
  // Access control overrides (null = inherit from alias/project)
  unauthorizedBehavior?: UnauthorizedBehavior | null;
  requiredRole?: RequiredRole | null;
  // SPA mode: when true, 404s fallback to index.html for client-side routing
  isSpa?: boolean;
  // WWW behavior for handling www/apex alternate domain
  wwwBehavior?: WwwBehavior | null;
  // Target domain for redirect domain type
  redirectTarget?: string;
}

// Phase B5: Domain visibility info response
export interface DomainVisibilityInfo {
  domainId: string;
  effectiveVisibility: 'public' | 'private';
  source: 'domain' | 'alias' | 'project';
  domainOverride?: boolean | null;
  aliasVisibility?: boolean | null;
  projectVisibility: boolean;
  // Access control info
  effectiveUnauthorizedBehavior?: UnauthorizedBehavior;
  effectiveRequiredRole?: RequiredRole;
}

export interface ListDomainsParams {
  projectId?: string;
  domainType?: 'subdomain' | 'custom' | 'redirect';
  isActive?: boolean;
}

// SSL Types
export interface WildcardChallengeResponse {
  recordName: string;
  recordValue: string;
  recordValues: string[]; // Multiple TXT record values (for wildcard + base domain)
  domain: string;
}

export interface WildcardCertificateStatus {
  exists: boolean;
  isSelfSigned?: boolean;
  issuer?: string;
  expiresAt?: string;
  daysUntilExpiry?: number;
  isExpiringSoon?: boolean;
}

export interface DomainSslStatus {
  sslEnabled: boolean;
  sslExpiresAt?: string;
  wildcardCertificateExists: boolean;
}

export interface DnsPropagationStatus {
  recordName: string;
  expectedValues: string[];
  foundValues: string[];
  allFound: boolean;
  missingValues: string[];
  error?: string;
}

export interface DnsVerificationResult {
  success: boolean;
  verified: boolean;
  domain: string;
  expectedIp?: string;
  resolvedIps?: string[];
  error?: string;
  // Alternate domain (www/non-www) info for SAN certificates
  alternateDomain?: string | null;
  alternateDomainVerified?: boolean;
  alternateDomainIps?: string[];
  alternateDomainError?: string;
  alternateDomainDnsInstructions?: {
    recordType: string;
    host: string;
    value: string;
    note: string;
  };
}

export interface DnsRequirements {
  domain: string;
  domainType: 'subdomain' | 'custom';
  dnsVerified: boolean;
  dnsVerifiedAt?: string;
  requirements?: {
    recordType: string;
    host: string;
    instructions: string[];
  } | null;
}

export interface DomainsConfig {
  baseDomain: string;
  mockSslMode?: boolean;
  platformIp?: string | null;
}

// Phase B: SSL Certificate Info Types
export interface SslCertificateInfo {
  type: 'wildcard' | 'individual';
  commonName: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  daysUntilExpiry: number;
  isValid: boolean;
  isExpiringSoon: boolean;
  serialNumber: string;
  fingerprint: string;
}

export interface DomainSslInfo extends SslCertificateInfo {
  domainId: string;
  domain: string;
  sslEnabled: boolean;
  autoRenewEnabled: boolean;
  lastRenewalAt: string | null;
  lastRenewalStatus: 'success' | 'failed' | null;
  wildcardCertDomain?: string;
}

export interface WildcardCertDetails {
  certificate: SslCertificateInfo | null;
  pendingChallenge: {
    recordName: string;
    recordValue: string;
    expiresAt: string;
  } | null;
  baseDomain: string;
}

// Phase B2: SSL Renewal History and Settings Types
export interface SslRenewalHistoryRecord {
  id: string;
  domainId: string | null;
  certificateType: 'wildcard' | 'individual';
  domain: string;
  status: 'success' | 'failed' | 'skipped';
  errorMessage: string | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
  triggeredBy: 'auto' | 'manual';
  createdAt: string;
}

export interface SslSettings {
  renewalThresholdDays: number;
  notificationEmail: string | null;
  wildcardAutoRenew: boolean;
}

// Redirect Types
export interface DomainRedirect {
  id: string;
  sourceDomain: string;
  targetDomainId: string;
  redirectType: '301' | '302';
  isActive: boolean;
  sslEnabled: boolean;
  nginxConfigPath?: string | null;
  targetDomain?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedirectRequest {
  sourceDomain: string;
  redirectType: '301' | '302';
  sslEnabled?: boolean;
}

export interface UpdateRedirectRequest {
  redirectType?: '301' | '302';
  isActive?: boolean;
  sslEnabled?: boolean;
}

// Path Redirect Types (for path-level redirects within a domain)
export interface PathRedirect {
  id: string;
  domainMappingId: string;
  sourcePath: string;
  targetPath: string;
  redirectType: '301' | '302';
  isActive: boolean;
  priority: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  domain?: string;
}

export interface CreatePathRedirectRequest {
  sourcePath: string;
  targetPath: string;
  redirectType?: '301' | '302';
  isActive?: boolean;
  priority?: string;
}

export interface UpdatePathRedirectRequest {
  sourcePath?: string;
  targetPath?: string;
  redirectType?: '301' | '302';
  isActive?: boolean;
  priority?: string;
}

// Phase C: Traffic Routing Types
export interface TrafficWeight {
  id: string;
  domainId: string;
  alias: string;
  weight: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficConfig {
  weights: TrafficWeight[];
  stickySessionsEnabled: boolean;
  stickySessionDuration: number;
}

export interface SetTrafficWeightsRequest {
  weights: { alias: string; weight: number }[];
  stickySessionsEnabled?: boolean;
  stickySessionDuration?: number;
}

// Traffic Rules Types
export interface TrafficRule {
  id: string;
  domainId: string;
  alias: string;
  conditionType: 'query_param' | 'cookie';
  conditionKey: string;
  conditionValue: string;
  priority: number;
  isActive: boolean;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTrafficRuleRequest {
  alias: string;
  conditionType: 'query_param' | 'cookie';
  conditionKey: string;
  conditionValue: string;
  priority?: number;
  label?: string;
}

export interface UpdateTrafficRuleRequest {
  alias?: string;
  conditionType?: 'query_param' | 'cookie';
  conditionKey?: string;
  conditionValue?: string;
  priority?: number;
  isActive?: boolean;
  label?: string;
}

export const domainsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Domain CRUD
    listDomains: builder.query<DomainMapping[], ListDomainsParams>({
      query: (params) => ({
        url: '/api/domains',
        params: {
          ...(params.projectId && { projectId: params.projectId }),
          ...(params.domainType && { domainType: params.domainType }),
          ...(params.isActive !== undefined && { isActive: String(params.isActive) }),
        },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Domain' as const, id })),
              { type: 'Domain' as const, id: 'LIST' },
            ]
          : [{ type: 'Domain' as const, id: 'LIST' }],
    }),

    getDomain: builder.query<DomainMapping, string>({
      query: (id) => `/api/domains/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Domain' as const, id }],
    }),

    createDomain: builder.mutation<DomainMapping, CreateDomainDto>({
      query: (body) => ({
        url: '/api/domains',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Domain' as const, id: 'LIST' }],
    }),

    updateDomain: builder.mutation<DomainMapping, { id: string; updates: UpdateDomainDto }>({
      query: ({ id, updates }) => ({
        url: `/api/domains/${id}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Domain' as const, id },
        { type: 'Domain' as const, id: 'LIST' },
      ],
    }),

    deleteDomain: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/domains/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'Domain' as const, id: 'LIST' }],
    }),

    // Wildcard SSL endpoints
    requestWildcardCertificate: builder.mutation<WildcardChallengeResponse, void>({
      query: () => ({
        url: '/api/domains/ssl/wildcard/request',
        method: 'POST',
      }),
    }),

    verifyWildcardCertificate: builder.mutation<{ success: boolean; message: string }, void>({
      query: () => ({
        url: '/api/domains/ssl/wildcard/verify',
        method: 'POST',
      }),
    }),

    getWildcardCertificateStatus: builder.query<WildcardCertificateStatus, void>({
      query: () => '/api/domains/ssl/wildcard/status',
    }),

    getPendingWildcardChallenge: builder.query<WildcardChallengeResponse | null, void>({
      query: () => '/api/domains/ssl/wildcard/pending',
    }),

    checkWildcardDnsPropagation: builder.query<DnsPropagationStatus, void>({
      query: () => '/api/domains/ssl/wildcard/check-dns',
    }),

    deleteWildcardCertificate: builder.mutation<
      { success: boolean; message?: string },
      void
    >({
      query: () => ({
        url: '/api/domains/ssl/wildcard',
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'Domain' as const, id: 'LIST' }],
    }),

    cancelPendingWildcardChallenge: builder.mutation<
      { success: boolean; message?: string },
      void
    >({
      query: () => ({
        url: '/api/domains/ssl/wildcard/pending',
        method: 'DELETE',
      }),
    }),

    // Per-domain DNS verification endpoints
    verifyDomainDns: builder.mutation<DnsVerificationResult, string>({
      query: (id) => ({
        url: `/api/domains/${id}/dns/verify`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Domain' as const, id },
        { type: 'Domain' as const, id: 'LIST' },
      ],
    }),

    getDomainDnsRequirements: builder.query<DnsRequirements, string>({
      query: (id) => `/api/domains/${id}/dns/status`,
      providesTags: (_result, _error, id) => [{ type: 'Domain' as const, id }],
    }),

    // Per-domain SSL endpoints
    requestDomainSsl: builder.mutation<{ success: boolean; message: string }, string>({
      query: (id) => ({
        url: `/api/domains/${id}/ssl/request`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'Domain' as const, id }],
    }),

    getDomainSslStatus: builder.query<DomainSslStatus, string>({
      query: (id) => `/api/domains/${id}/ssl/status`,
    }),

    // Phase B: SSL Certificate Details
    getSslDetails: builder.query<DomainSslInfo, string>({
      query: (domainId) => `/api/domains/${domainId}/ssl/details`,
      providesTags: (_result, _error, domainId) => [
        { type: 'DomainSsl' as const, id: domainId },
      ],
    }),

    renewCertificate: builder.mutation<
      { success: boolean; error?: string; expiresAt?: string },
      string
    >({
      query: (domainId) => ({
        url: `/api/domains/${domainId}/ssl/renew`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, domainId) => [
        { type: 'DomainSsl' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    updateAutoRenew: builder.mutation<
      { autoRenewEnabled: boolean },
      { domainId: string; enabled: boolean }
    >({
      query: ({ domainId, enabled }) => ({
        url: `/api/domains/${domainId}/ssl/auto-renew`,
        method: 'PATCH',
        body: { enabled },
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'DomainSsl' as const, id: domainId },
      ],
    }),

    getWildcardCertDetails: builder.query<WildcardCertDetails, void>({
      query: () => '/api/domains/ssl/wildcard/details',
      providesTags: ['WildcardCert'],
    }),

    // Phase B2: SSL Renewal History and Settings
    getSslRenewalHistory: builder.query<
      SslRenewalHistoryRecord[],
      { domainId: string; limit?: number }
    >({
      query: ({ domainId, limit = 10 }) =>
        `/api/domains/${domainId}/ssl/history?limit=${limit}`,
      providesTags: (_result, _error, { domainId }) => [
        { type: 'SslHistory' as const, id: domainId },
      ],
    }),

    getAllSslRenewalHistory: builder.query<SslRenewalHistoryRecord[], { limit?: number }>({
      query: ({ limit = 50 }) => `/api/domains/ssl/history?limit=${limit}`,
      providesTags: ['SslHistory'],
    }),

    getSslSettings: builder.query<SslSettings, void>({
      query: () => '/api/domains/ssl/settings',
      providesTags: ['SslSettings'],
    }),

    updateSslSettings: builder.mutation<SslSettings, Partial<SslSettings>>({
      query: (body) => ({
        url: '/api/domains/ssl/settings',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['SslSettings'],
    }),

    triggerRenewalCheck: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: '/api/domains/ssl/renewal/trigger',
        method: 'POST',
      }),
      invalidatesTags: ['SslHistory'],
    }),

    // Phase B5: Domain visibility
    getDomainVisibility: builder.query<DomainVisibilityInfo, string>({
      query: (id) => `/api/domains/${id}/visibility`,
      providesTags: (_result, _error, id) => [{ type: 'Domain' as const, id }],
    }),

    // Configuration
    getDomainsConfig: builder.query<DomainsConfig, void>({
      query: () => '/api/domains/config',
    }),

    // Redirects
    getRedirects: builder.query<DomainRedirect[], string>({
      query: (domainId) => `/api/domains/${domainId}/redirects`,
      providesTags: (_result, _error, domainId) => [
        { type: 'DomainRedirects' as const, id: domainId },
      ],
    }),

    createRedirect: builder.mutation<
      DomainRedirect,
      { domainId: string; body: CreateRedirectRequest }
    >({
      query: ({ domainId, body }) => ({
        url: `/api/domains/${domainId}/redirects`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'DomainRedirects' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    updateRedirect: builder.mutation<
      DomainRedirect,
      { redirectId: string; body: UpdateRedirectRequest }
    >({
      query: ({ redirectId, body }) => ({
        url: `/api/domains/redirects/${redirectId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (result) => [
        { type: 'DomainRedirects' as const, id: result?.targetDomainId },
      ],
    }),

    deleteRedirect: builder.mutation<
      { success: boolean },
      { redirectId: string; domainId: string }
    >({
      query: ({ redirectId }) => ({
        url: `/api/domains/redirects/${redirectId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'DomainRedirects' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    // Path Redirects (path-level redirects within a domain)
    getPathRedirects: builder.query<PathRedirect[], string>({
      query: (domainId) => `/api/domains/${domainId}/path-redirects`,
      providesTags: (_result, _error, domainId) => [
        { type: 'PathRedirects' as const, id: domainId },
      ],
    }),

    createPathRedirect: builder.mutation<
      PathRedirect,
      { domainId: string; body: CreatePathRedirectRequest }
    >({
      query: ({ domainId, body }) => ({
        url: `/api/domains/${domainId}/path-redirects`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'PathRedirects' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    updatePathRedirect: builder.mutation<
      PathRedirect,
      { pathRedirectId: string; domainId: string; body: UpdatePathRedirectRequest }
    >({
      query: ({ pathRedirectId, body }) => ({
        url: `/api/domains/path-redirects/${pathRedirectId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'PathRedirects' as const, id: domainId },
      ],
    }),

    deletePathRedirect: builder.mutation<
      { success: boolean },
      { pathRedirectId: string; domainId: string }
    >({
      query: ({ pathRedirectId }) => ({
        url: `/api/domains/path-redirects/${pathRedirectId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'PathRedirects' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    // Phase C: Traffic Routing
    getTrafficConfig: builder.query<TrafficConfig, string>({
      query: (domainId) => `/api/domains/${domainId}/traffic`,
      providesTags: (_result, _error, domainId) => [
        { type: 'DomainTraffic' as const, id: domainId },
      ],
    }),

    setTrafficWeights: builder.mutation<
      TrafficConfig,
      { domainId: string; body: SetTrafficWeightsRequest }
    >({
      query: ({ domainId, body }) => ({
        url: `/api/domains/${domainId}/traffic`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'DomainTraffic' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    clearTrafficWeights: builder.mutation<{ success: boolean }, string>({
      query: (domainId) => ({
        url: `/api/domains/${domainId}/traffic`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, domainId) => [
        { type: 'DomainTraffic' as const, id: domainId },
        { type: 'Domain' as const, id: domainId },
      ],
    }),

    getAvailableAliases: builder.query<string[], string>({
      query: (domainId) => `/api/domains/${domainId}/traffic/aliases`,
    }),

    // Traffic Rules
    getTrafficRules: builder.query<TrafficRule[], string>({
      query: (domainId) => `/api/domains/${domainId}/traffic/rules`,
      providesTags: (_result, _error, domainId) => [
        { type: 'TrafficRule' as const, id: domainId },
      ],
    }),

    createTrafficRule: builder.mutation<
      TrafficRule,
      { domainId: string; body: CreateTrafficRuleRequest }
    >({
      query: ({ domainId, body }) => ({
        url: `/api/domains/${domainId}/traffic/rules`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'TrafficRule' as const, id: domainId },
      ],
    }),

    updateTrafficRule: builder.mutation<
      TrafficRule,
      { ruleId: string; domainId: string; body: UpdateTrafficRuleRequest }
    >({
      query: ({ ruleId, body }) => ({
        url: `/api/domains/traffic/rules/${ruleId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'TrafficRule' as const, id: domainId },
      ],
    }),

    deleteTrafficRule: builder.mutation<
      { success: boolean },
      { ruleId: string; domainId: string }
    >({
      query: ({ ruleId }) => ({
        url: `/api/domains/traffic/rules/${ruleId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { domainId }) => [
        { type: 'TrafficRule' as const, id: domainId },
      ],
    }),
  }),
});

export const {
  useListDomainsQuery,
  useGetDomainQuery,
  useCreateDomainMutation,
  useUpdateDomainMutation,
  useDeleteDomainMutation,
  useRequestWildcardCertificateMutation,
  useVerifyWildcardCertificateMutation,
  useGetWildcardCertificateStatusQuery,
  useGetPendingWildcardChallengeQuery,
  useCheckWildcardDnsPropagationQuery,
  useLazyCheckWildcardDnsPropagationQuery,
  useDeleteWildcardCertificateMutation,
  useCancelPendingWildcardChallengeMutation,
  useVerifyDomainDnsMutation,
  useGetDomainDnsRequirementsQuery,
  useRequestDomainSslMutation,
  useGetDomainSslStatusQuery,
  // Phase B: SSL Certificate Details
  useGetSslDetailsQuery,
  useRenewCertificateMutation,
  useUpdateAutoRenewMutation,
  useGetWildcardCertDetailsQuery,
  // Phase B2: SSL Renewal History and Settings
  useGetSslRenewalHistoryQuery,
  useGetAllSslRenewalHistoryQuery,
  useGetSslSettingsQuery,
  useUpdateSslSettingsMutation,
  useTriggerRenewalCheckMutation,
  useGetDomainVisibilityQuery,
  useGetDomainsConfigQuery,
  // Redirects (domain-level)
  useGetRedirectsQuery,
  useCreateRedirectMutation,
  useUpdateRedirectMutation,
  useDeleteRedirectMutation,
  // Path Redirects (path-level within a domain)
  useGetPathRedirectsQuery,
  useCreatePathRedirectMutation,
  useUpdatePathRedirectMutation,
  useDeletePathRedirectMutation,
  // Phase C: Traffic Routing
  useGetTrafficConfigQuery,
  useSetTrafficWeightsMutation,
  useClearTrafficWeightsMutation,
  useGetAvailableAliasesQuery,
  // Traffic Rules
  useGetTrafficRulesQuery,
  useCreateTrafficRuleMutation,
  useUpdateTrafficRuleMutation,
  useDeleteTrafficRuleMutation,
} = domainsApi;
