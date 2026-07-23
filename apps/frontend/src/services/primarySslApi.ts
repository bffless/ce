import { api } from './api';

export interface PrimarySslStatus {
  domain: string | null;
  proxyMode: 'cloudflare' | 'proxy' | 'none' | null;
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned' | null;
  port80: 'closed' | 'redirect' | null;
  realIp: { header: string; ranges: string[] } | { preset: 'cloudflare' } | null;
  cert: { commonName: string; issuer: string; expiresAt: string; daysUntilExpiry: number; isValid: boolean } | null;
  wildcardCovered: boolean;
  pendingRevert: { deadlineMs: number } | null;
}

export interface PrimarySslApplyBody {
  proxyMode: 'cloudflare' | 'proxy' | 'none';
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned';
  port80?: 'closed' | 'redirect';
  realIp?: { header: string; ranges: string[] };
}

export interface PrimarySslPasteBody {
  certificatePem: string; privateKeyPem: string;
  servingMode: 'cloudflare' | 'proxy' | 'none';
}

export interface PreflightResult {
  ok: boolean;
  checks: { host: string; resolvedIps: string[]; probeOk: boolean; error?: string }[];
}

export const primarySslApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPrimarySslStatus: builder.query<PrimarySslStatus, void>({
      query: () => '/api/admin/ssl/status',
      providesTags: ['PrimarySsl'],
    }),
    primarySslPreflight: builder.mutation<PreflightResult, void>({
      query: () => ({ url: '/api/admin/ssl/preflight', method: 'POST' }),
    }),
    stagePrimaryCertificate: builder.mutation<{ sans: string[]; wildcardCovered: boolean }, PrimarySslPasteBody>({
      query: (body) => ({ url: '/api/admin/ssl/certificate', method: 'POST', body }),
    }),
    issuePrimaryLetsEncrypt: builder.mutation<{ issued: boolean; sans: string[]; reused: boolean }, void>({
      query: () => ({ url: '/api/admin/ssl/letsencrypt', method: 'POST' }),
    }),
    applyPrimarySsl: builder.mutation<{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }, PrimarySslApplyBody>({
      query: (body) => ({ url: '/api/admin/ssl/apply', method: 'POST', body }),
      invalidatesTags: ['PrimarySsl'],
    }),
    confirmPrimarySsl: builder.mutation<{ confirmed: true }, void>({
      query: () => ({ url: '/api/admin/ssl/confirm', method: 'POST' }),
      invalidatesTags: ['PrimarySsl'],
    }),
    rollbackPrimarySsl: builder.mutation<{ rolledBack: true }, void>({
      query: () => ({ url: '/api/admin/ssl/rollback', method: 'POST' }),
      invalidatesTags: ['PrimarySsl'],
    }),
  }),
});

export const {
  useGetPrimarySslStatusQuery, usePrimarySslPreflightMutation, useStagePrimaryCertificateMutation,
  useIssuePrimaryLetsEncryptMutation, useApplyPrimarySslMutation, useConfirmPrimarySslMutation,
  useRollbackPrimarySslMutation,
} = primarySslApi;
