import { api } from './api';

/**
 * The persisted Request log + per-IP rollup (issue #390): the bot-signal
 * subset (Unmatched, and blocked once #391 lands) of what the application
 * interceptor observes, admin-only.
 */

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
  }),
});

export const { useListTrafficRequestsQuery, useListTrafficIpRollupsQuery } = trafficApi;

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
