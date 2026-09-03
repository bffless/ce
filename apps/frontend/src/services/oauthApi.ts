import { api } from './api';

/** What `GET /api/oauth/consent?request=` answers — the consent page's content. */
export interface PendingConsent {
  clientName: string;
  scopes: string[];
  project: { id: string; slug: string; name: string };
  redirectHost: string;
  expiresAt: string;
}

export const oauthApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPendingConsent: builder.query<PendingConsent, string>({
      query: (request) => `/api/oauth/consent?request=${encodeURIComponent(request)}`,
    }),
    decideConsent: builder.mutation<
      { redirectTo: string },
      { request: string; approve: boolean; scopes?: string[] }
    >({
      query: (body) => ({ url: '/api/oauth/consent', method: 'POST', body }),
    }),
  }),
});

export const { useGetPendingConsentQuery, useDecideConsentMutation } = oauthApi;
