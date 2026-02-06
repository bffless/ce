import { api } from './api';

export type FlagSource = 'default' | 'env' | 'file' | 'database';
export type FlagType = 'boolean' | 'string' | 'number' | 'json';
export type FlagValue = boolean | string | number | object;

export interface FeatureFlag {
  key: string;
  value: FlagValue;
  type: FlagType;
  source: FlagSource;
  description: string;
  category: string;
}

export interface FeatureFlagsResponse {
  flags: FeatureFlag[];
}

export interface FeatureFlagsByCategory {
  features?: FeatureFlag[];
  limits?: FeatureFlag[];
  integrations?: FeatureFlag[];
  experimental?: FeatureFlag[];
}

/** Client flags response - simple key-value map */
export type ClientFlagsResponse = Record<string, FlagValue>;

export const featureFlagsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Get client-exposed feature flags (single request, allowlisted only)
    getClientFlags: builder.query<ClientFlagsResponse, void>({
      query: () => '/api/feature-flags/client',
      providesTags: ['FeatureFlags'],
    }),

    // Get all feature flags (admin)
    getFeatureFlags: builder.query<FeatureFlagsResponse, void>({
      query: () => '/api/feature-flags',
      providesTags: ['FeatureFlags'],
    }),

    // Get feature flags grouped by category (admin)
    getFeatureFlagsByCategory: builder.query<FeatureFlagsByCategory, void>({
      query: () => '/api/feature-flags/grouped',
      providesTags: ['FeatureFlags'],
    }),

    // Get a single feature flag (admin)
    getFeatureFlag: builder.query<FeatureFlag, string>({
      query: (key) => `/api/feature-flags/${key}`,
      providesTags: (_result, _error, key) => [{ type: 'FeatureFlags', id: key }],
    }),
  }),
});

export const {
  useGetClientFlagsQuery,
  useGetFeatureFlagsQuery,
  useGetFeatureFlagsByCategoryQuery,
  useGetFeatureFlagQuery,
} = featureFlagsApi;

/**
 * Hook to get all client-exposed feature flags
 * Returns { flags, isLoading, isReady, isEnabled(key) }
 *
 * IMPORTANT: isEnabled returns `false` while loading to prevent:
 * - Unwanted API calls before flags are known
 * - UI flickering (show → hide)
 *
 * Components should check `isLoading` to show skeletons if needed.
 */
export function useFeatureFlags() {
  const { data: flags, isLoading } = useGetClientFlagsQuery();
  const isReady = !isLoading && flags !== undefined;

  const isEnabled = (key: string): boolean => {
    // Return false while loading to prevent premature renders/API calls
    if (!isReady) return false;
    const value = flags![key];
    // Default to true if flag not in allowlist (not explicitly disabled)
    if (value === undefined) return true;
    return Boolean(value);
  };

  const getValue = <T = FlagValue>(key: string, defaultValue: T): T => {
    if (!isReady) return defaultValue;
    const value = flags![key];
    if (value === undefined) return defaultValue;
    return value as T;
  };

  return { flags, isLoading, isReady, isEnabled, getValue };
}
