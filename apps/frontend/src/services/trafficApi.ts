import { api } from './api';

/**
 * The persisted Request log + per-IP rollup (issue #390): the bot-signal
 * subset (Unmatched, and blocked once #391 lands) of what the application
 * interceptor observes, admin-only.
 */

export type BlocklistMatchType = 'prefix' | 'exact' | 'suffix' | 'extension' | 'contains';

export interface BlocklistPatternEntry {
  matchType: BlocklistMatchType;
  value: string;
}

/** A domain a Blocklist is attached to (issue #393). */
export interface AttachedDomainRef {
  id: string;
  domain: string;
}

/** A named Blocklist from the admin-global library (issues #391/#393). */
export interface BlocklistEntry {
  id: string;
  name: string;
  description: string | null;
  /** True = applies to all domains (the all-domains default attachment). */
  isDefault: boolean;
  /** Domains this list is explicitly attached to (relevant when !isDefault). */
  attachedDomains: AttachedDomainRef[];
  entries: BlocklistPatternEntry[];
  allowlist: BlocklistPatternEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface BlocklistSettings {
  /** Master toggle: false disables ALL blocking (Baseline and lists) instantly. */
  enabled: boolean;
  baselineEntryCount: number;
}

export interface UpsertBlocklistInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  entries?: BlocklistPatternEntry[];
  allowlist?: BlocklistPatternEntry[];
}

export interface TrafficRequestEntry {
  id: string;
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  httpVersion: string;
  status: number;
  bytes: number;
  referer: string | null;
  userAgent: string | null;
  host: string | null;
  classification: 'unmatched' | 'blocked';
  /** The record rendered as an nginx combined-access-log line */
  line: string;
}

export interface TrafficIpRollupEntry {
  id: string;
  ip: string;
  requestCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  samplePaths: string[];
  sampleUserAgents: string[];
}

export interface TrafficPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TrafficRequestFilters {
  ip?: string;
  path?: string;
  status?: number;
  classification?: 'unmatched' | 'blocked';
  from?: string;
  to?: string;
}

export interface ListTrafficRequestsParams extends TrafficRequestFilters {
  page?: number;
  pageSize?: number;
}

export interface ListTrafficIpRollupsParams {
  ip?: string;
  sortBy?: 'requestCount' | 'lastSeenAt' | 'firstSeenAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const trafficApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listTrafficRequests: builder.query<
      TrafficPaginatedResponse<TrafficRequestEntry>,
      ListTrafficRequestsParams | void
    >({
      query: (params) => `/api/traffic/requests${toQueryString({ ...(params ?? {}) })}`,
      providesTags: [{ type: 'TrafficRequest' as const, id: 'LIST' }],
    }),

    listTrafficIpRollups: builder.query<
      TrafficPaginatedResponse<TrafficIpRollupEntry>,
      ListTrafficIpRollupsParams | void
    >({
      query: (params) => `/api/traffic/ips${toQueryString({ ...(params ?? {}) })}`,
      providesTags: [{ type: 'TrafficIpRollup' as const, id: 'LIST' }],
    }),

    getBlocklistSettings: builder.query<BlocklistSettings, void>({
      query: () => '/api/traffic/blocklist-settings',
      providesTags: ['BlocklistSettings'],
    }),

    updateBlocklistSettings: builder.mutation<BlocklistSettings, { enabled: boolean }>({
      query: (body) => ({
        url: '/api/traffic/blocklist-settings',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['BlocklistSettings'],
    }),

    getBaselineBlocklist: builder.query<{ entries: BlocklistPatternEntry[] }, void>({
      query: () => '/api/traffic/blocklists/baseline',
    }),

    listBlocklists: builder.query<BlocklistEntry[], void>({
      query: () => '/api/traffic/blocklists',
      providesTags: [{ type: 'Blocklist' as const, id: 'LIST' }],
    }),

    createBlocklist: builder.mutation<BlocklistEntry, UpsertBlocklistInput>({
      query: (body) => ({
        url: '/api/traffic/blocklists',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Blocklist' as const, id: 'LIST' }],
    }),

    updateBlocklist: builder.mutation<BlocklistEntry, { id: string } & UpsertBlocklistInput>({
      query: ({ id, ...body }) => ({
        url: `/api/traffic/blocklists/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: [{ type: 'Blocklist' as const, id: 'LIST' }],
    }),

    deleteBlocklist: builder.mutation<void, string>({
      query: (id) => ({
        url: `/api/traffic/blocklists/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'Blocklist' as const, id: 'LIST' }],
    }),

    appendBlocklistEntry: builder.mutation<BlocklistEntry, { id: string } & BlocklistPatternEntry>({
      query: ({ id, ...body }) => ({
        url: `/api/traffic/blocklists/${id}/entries`,
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Blocklist' as const, id: 'LIST' }],
    }),

    getDomainBlocklists: builder.query<{ domainMappingId: string; blocklistIds: string[] }, string>(
      {
        query: (domainMappingId) => `/api/traffic/domains/${domainMappingId}/blocklists`,
        providesTags: (_result, _error, domainMappingId) => [
          { type: 'Blocklist' as const, id: `DOMAIN-${domainMappingId}` },
        ],
      },
    ),

    syncDomainBlocklists: builder.mutation<
      { domainMappingId: string; blocklistIds: string[] },
      { domainMappingId: string; blocklistIds: string[] }
    >({
      query: ({ domainMappingId, blocklistIds }) => ({
        url: `/api/traffic/domains/${domainMappingId}/blocklists`,
        method: 'PUT',
        body: { blocklistIds },
      }),
      invalidatesTags: (_result, _error, { domainMappingId }) => [
        { type: 'Blocklist' as const, id: 'LIST' },
        { type: 'Blocklist' as const, id: `DOMAIN-${domainMappingId}` },
      ],
    }),
  }),
});

export const {
  useListTrafficRequestsQuery,
  useListTrafficIpRollupsQuery,
  useGetBlocklistSettingsQuery,
  useUpdateBlocklistSettingsMutation,
  useGetBaselineBlocklistQuery,
  useListBlocklistsQuery,
  useCreateBlocklistMutation,
  useUpdateBlocklistMutation,
  useDeleteBlocklistMutation,
  useAppendBlocklistEntryMutation,
  useGetDomainBlocklistsQuery,
  useSyncDomainBlocklistsMutation,
} = trafficApi;

/**
 * Download a Request-log or per-IP-rollup export (CSV/JSON) as a file.
 * Mirrors downloadSchemaExport in pipelineSchemasApi.
 */
export async function downloadTrafficExport(
  kind: 'requests' | 'ips',
  format: 'csv' | 'json',
  filters: Record<string, string | number | undefined> = {},
): Promise<void> {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  const qs = toQueryString({ ...filters, format });
  const response = await fetch(`${baseUrl}/api/traffic/${kind}/export${qs}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = kind === 'requests' ? `request-log.${format}` : `ip-rollup.${format}`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
