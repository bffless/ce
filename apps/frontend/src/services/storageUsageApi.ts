import { api } from './api';

/**
 * Workspace storage usage with quota information
 */
export interface WorkspaceStorageUsage {
  totalBytes: number;
  assetCount: number;
  quotaBytes: number | null; // null = unlimited
  usagePercent: number | null;
  overageBytes: number;
  isOverQuota: boolean;
  isNearQuota: boolean;
  overageBehavior: 'block' | 'charge' | 'unlimited';
  overagePricePerGb: number | null;
  planName: string | null; // null for self-hosted CE
}

/**
 * Storage usage breakdown by project
 */
export interface ProjectUsage {
  projectId: string;
  projectName: string;
  owner: string;
  assetCount: number;
  totalBytes: number;
  percentOfTotal: number;
}

/**
 * Storage usage breakdown by branch
 */
export interface BranchUsage {
  branch: string;
  assetCount: number;
  totalBytes: number;
  commitCount: number;
  percentOfProject: number;
}

/**
 * Quota configuration
 */
export interface QuotaConfig {
  quotaBytes: number | null;
  overageBehavior: 'block' | 'charge' | 'unlimited';
  overagePricePerGb: number | null;
  alertThresholdPercent: number;
  planName: string | null;
}

export const storageUsageApi = api.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Get workspace storage usage with quota info
     */
    getStorageUsage: builder.query<WorkspaceStorageUsage, void>({
      query: () => '/api/storage/usage',
      providesTags: ['StorageUsage'],
    }),

    /**
     * Get storage usage breakdown by project
     */
    getUsageByProject: builder.query<ProjectUsage[], void>({
      query: () => '/api/storage/usage/by-project',
      providesTags: ['StorageUsage'],
    }),

    /**
     * Get storage usage breakdown by branch for a project
     */
    getUsageByBranch: builder.query<BranchUsage[], string>({
      query: (projectId) => `/api/storage/usage/by-branch/${projectId}`,
      providesTags: (_result, _error, projectId) => [
        { type: 'StorageUsage', id: projectId },
      ],
    }),

    /**
     * Get quota configuration
     */
    getQuotaConfig: builder.query<QuotaConfig, void>({
      query: () => '/api/storage/quota',
      providesTags: ['StorageUsage'],
    }),
  }),
});

export const {
  useGetStorageUsageQuery,
  useGetUsageByProjectQuery,
  useGetUsageByBranchQuery,
  useGetQuotaConfigQuery,
} = storageUsageApi;

// Utility functions for formatting

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Calculate estimated overage cost
 */
export function calculateOverageCost(
  overageBytes: number,
  pricePerGb: number | null,
): number | null {
  if (!pricePerGb || overageBytes <= 0) return null;
  const overageGb = overageBytes / (1024 * 1024 * 1024);
  return Math.ceil(overageGb) * pricePerGb;
}
