import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { Mutex } from 'async-mutex';

// Mutex to prevent multiple refresh calls (official RTK Query pattern)
const mutex = new Mutex();

/**
 * Check if current route is a public page
 * Public pages don't require authentication and shouldn't redirect to login on 401
 */
function isPublicRoute(pathname: string): boolean {
  // Auth pages (login/signup/password-reset)
  if (pathname === '/login' || pathname === '/signup') return true;
  if (pathname === '/forgot-password' || pathname === '/reset-password') return true;
  // Email verification page
  if (pathname === '/verify-email') return true;
  // Setup page (pre-auth)
  if (pathname === '/setup') return true;
  // Invitation accept page (pre-auth for validation)
  if (pathname.startsWith('/invite/')) return true;

  // Public repository pages (we don't know if public until we fetch)
  // These pages should handle 401s gracefully in their UI
  if (pathname.startsWith('/repo/')) {
    // Exclude settings pages (always protected)
    if (pathname.includes('/settings')) return false;
    // All other repo pages can be public
    return true;
  }

  // User groups page (can be public)
  if (pathname.startsWith('/groups')) return true;

  // All other routes are protected by default
  return false;
}

// Custom base query that handles Blob errors
const baseQuery = fetchBaseQuery({
  // In development, use relative URLs (proxied by Vite to localhost:3000)
  // In production, VITE_API_URL can be set to a specific domain or left empty for relative URLs
  baseUrl: import.meta.env.VITE_API_URL || '',
  credentials: 'include', // Include cookies for authentication
});

// Wrapper to convert Blob errors to text (serializable)
const baseQueryWithBlobErrorHandling: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);

  // If there's an error and the error data is a Blob, convert it to text
  if (result.error && result.error.data instanceof Blob) {
    try {
      const text = await result.error.data.text();
      // Mutate the error data instead of creating a new object to preserve type
      (result.error as any).data = text;
    } catch (e) {
      (result.error as any).data = 'Failed to read error response';
    }
  }

  return result;
};

/**
 * Base query with automatic token refresh
 * Official RTK Query pattern: https://redux-toolkit.js.org/rtk-query/usage/customizing-queries#automatic-re-authorization-by-extending-fetchbasequery
 */
const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  // Wait for mutex if refresh is in progress
  await mutex.waitForUnlock();

  let result = await baseQueryWithBlobErrorHandling(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    const currentPath = window.location.pathname;

    // Don't attempt refresh if on auth pages (prevents loops)
    if (currentPath === '/login' || currentPath === '/signup') {
      return result;
    }

    // Check if current route is public (needed for redirect logic)
    const isPublic = isPublicRoute(currentPath);

    // Check error message from SuperTokens
    const errorMessage =
      typeof result.error.data === 'string'
        ? result.error.data
        : (result.error.data as any)?.message || '';

    // "unauthorised" = no session exists at all, skip any refresh logic
    const isNoSession = errorMessage.toLowerCase().includes('unauthorised');

    if (isNoSession) {
      // No session at all - redirect if on protected page, otherwise return error
      if (!isPublic) {
        api.dispatch({ type: 'auth/sessionExpired' });
        window.location.href = '/login?redirect=' + encodeURIComponent(currentPath);
      }
      return result;
    }

    // Any 401 (except "unauthorised") should attempt refresh
    // This handles race conditions where multiple requests get 401 simultaneously
    // Only one will acquire the mutex, others will wait
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();

      try {
        // Try to refresh token
        const refreshResult = await baseQuery(
          { url: '/api/auth/session/refresh', method: 'POST' },
          api,
          extraOptions,
        );

        if (refreshResult.meta?.response?.ok) {
          // Refresh succeeded - retry original request
          result = await baseQueryWithBlobErrorHandling(args, api, extraOptions);
        } else {
          // Refresh failed - either no session or both tokens expired
          api.dispatch({ type: 'auth/sessionExpired' });

          if (!isPublic) {
            window.location.href = '/login?redirect=' + encodeURIComponent(currentPath);
          }
        }
      } finally {
        release();
      }
    } else {
      // Another request is already refreshing - wait for it, then retry
      await mutex.waitForUnlock();
      result = await baseQueryWithBlobErrorHandling(args, api, extraOptions);
    }
  }

  // Handle 403 EMAIL_NOT_VERIFIED - redirect to verification page
  if (result.error && result.error.status === 403) {
    const errorData = result.error.data as Record<string, unknown> | undefined;
    if (errorData?.error === 'EMAIL_NOT_VERIFIED') {
      if (!window.location.pathname.startsWith('/verify-email')) {
        window.location.href = '/verify-email';
      }
    }
  }

  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth, // Use reauth wrapper instead of blob-only wrapper
  tagTypes: [
    'Asset',
    'ApiKey',
    'User',
    'Setup',
    'Project',
    'Permission',
    'UserGroup',
    'Repository',
    'Domain',
    'DomainRedirects',
    'DomainSsl',
    'DomainTraffic',
    'WildcardCert',
    'SslHistory',
    'SslSettings',
    'PrimaryContent',
    'ProxyRule',
    'ProxyRuleSet',
    'SmtpSettings',
    'EmailSettings',
    'PathPreference',
    'FeatureFlags',
    'Invitation',
    'RetentionRule',
    'RetentionLog',
    'StorageOverview',
    'CacheRule',
    'StorageUsage',
    'PathRedirects',
    'ShareLink',
    'TrafficRule',
  ],
  endpoints: () => ({}),
});
