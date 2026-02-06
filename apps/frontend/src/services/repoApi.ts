import { api } from './api';

export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

// Type definitions based on backend API responses
export interface FileItem {
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
  isPublic: boolean;
  createdAt: string;
}

export interface FileTreeResponse {
  commitSha: string;
  repository: string;
  branch: string | null;
  files: FileItem[];
}

export interface AliasRef {
  name: string;
  commitSha: string;
  updatedAt: string;
  isAutoPreview: boolean;
}

export interface BranchRef {
  name: string;
  latestCommit: string;
  latestDeployedAt: string;
  fileCount: number;
}

export interface CommitRef {
  sha: string;
  shortSha: string;
  branch: string;
  description: string | null;
  deployedAt: string;
  parentShas: string[];
}

// Pagination info for cursor-based pagination
export interface PaginationInfo {
  hasMore: boolean;
  nextCursor?: string;
  total: number;
}

// Query params for refs endpoint pagination
export interface RepositoryRefsQueryParams {
  cursor?: string;
  limit?: number;
}

export interface RepositoryRefsResponse {
  aliases: AliasRef[];
  branches: BranchRef[];
  recentCommits: CommitRef[];
  pagination: PaginationInfo;
}

// Deployment types for the repository overview
export interface Deployment {
  id: string;
  commitSha: string;
  shortSha: string;
  branch: string;
  description: string;
  deployedAt: string;
  fileCount: number;
  totalSize: number;
  isPublic: boolean;
}

export interface DeploymentsResponse {
  repository: string;
  page: number;
  limit: number;
  total: number;
  deployments: Deployment[];
}

export interface RepositoryStats {
  repository: string;
  totalDeployments: number;
  totalStorageBytes: number;
  totalStorageMB: number;
  lastDeployedAt: string | null;
  branchCount: number;
  aliasCount: number;
  isPublic: boolean;
}

// Alias detail type (more detailed than AliasRef)
export interface AliasDetail {
  id: string;
  name: string;
  commitSha: string;
  shortSha: string;
  branch: string;
  deploymentId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  // Phase B5: Visibility override (null = inherit from project)
  isPublic?: boolean | null;
  // Access control overrides (null = inherit from project)
  unauthorizedBehavior?: UnauthorizedBehavior | null;
  requiredRole?: RequiredRole | null;
  // Auto-preview alias fields
  isAutoPreview?: boolean;
  basePath?: string;
  // Proxy rule set assignment
  proxyRuleSetId?: string | null;
}

// Phase B5: Alias visibility types
export interface AliasVisibilityInfo {
  projectId: string;
  alias: string;
  effectiveVisibility: 'public' | 'private';
  source: 'alias' | 'project';
  aliasOverride?: boolean | null;
  projectVisibility: boolean;
  // Access control info
  effectiveUnauthorizedBehavior?: UnauthorizedBehavior;
  effectiveRequiredRole?: RequiredRole;
}

export interface UpdateAliasVisibilityRequest {
  isPublic?: boolean | null;
  unauthorizedBehavior?: UnauthorizedBehavior | null;
  requiredRole?: RequiredRole | null;
}

export interface AliasesResponse {
  repository: string;
  aliases: AliasDetail[];
}

export interface CreateAliasRequest {
  name: string;
  commitSha: string;
  proxyRuleSetId?: string;
}

export interface UpdateAliasRequest {
  commitSha?: string;
  proxyRuleSetId?: string | null;
}

// Commit details types
export interface CommitInfo {
  sha: string;
  shortSha: string;
  message?: string;
  author?: string;
  authorName?: string;
  committedAt?: string;
  branch: string;
}

export interface DeploymentInfo {
  id: string;
  fileCount: number;
  totalSize: number;
  deployedAt: string;
  description?: string;
  workflowName?: string;
}

export interface CommitAlias {
  name: string;
  createdAt: string;
  isAutoPreview?: boolean;
  basePath?: string;
  proxyRuleSetId?: string | null;
  proxyRuleSetName?: string | null;
}

export interface CommitDetailsResponse {
  commit: CommitInfo;
  deployments: DeploymentInfo[];
  aliases: CommitAlias[];
  readmePath?: string;
  parentShas?: string[];
}

// Delete commit types
export interface DeleteCommitRequest {
  owner: string;
  repo: string;
  commitSha: string;
}

export interface DeleteCommitResponse {
  message: string;
  deletedDeployments: number;
  deletedFiles: number;
  freedBytes: number;
}

export interface DeleteCommitError {
  statusCode: number;
  message: string;
  aliases?: string[];
}

// Extend the base API with repository endpoints
export const repoApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getFileTree: builder.query<
      FileTreeResponse,
      { owner: string; repo: string; commitSha: string }
    >({
      query: ({ owner, repo, commitSha }) =>
        `/api/repo/${owner}/${repo}/${commitSha}/files`,
      providesTags: (_result, _error, { owner, repo, commitSha }) => [
        { type: 'Asset', id: `${owner}/${repo}/${commitSha}` },
      ],
    }),
    getRepositoryRefs: builder.query<
      RepositoryRefsResponse,
      { owner: string; repo: string; cursor?: string; limit?: number }
    >({
      query: ({ owner, repo, cursor, limit = 50 }) => {
        const params = new URLSearchParams();
        if (cursor) params.append('cursor', cursor);
        params.append('limit', limit.toString());
        const queryString = params.toString();
        return `/api/repo/${owner}/${repo}/refs${queryString ? `?${queryString}` : ''}`;
      },
      // Normalize cache key so limit defaults to 50 for cache matching
      serializeQueryArgs: ({ queryArgs }) => {
        const { owner, repo, cursor, limit = 50 } = queryArgs;
        return { owner, repo, cursor, limit };
      },
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/refs` },
      ],
    }),
    getDeployments: builder.query<
      DeploymentsResponse,
      {
        owner: string;
        repo: string;
        page?: number;
        limit?: number;
        branch?: string;
        sortBy?: 'date' | 'branch';
        order?: 'asc' | 'desc';
      }
    >({
      query: ({ owner, repo, page = 1, limit = 20, branch, sortBy, order }) => {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
        });
        if (branch) params.append('branch', branch);
        if (sortBy) params.append('sortBy', sortBy);
        if (order) params.append('order', order);
        return `/api/repo/${owner}/${repo}/deployments?${params.toString()}`;
      },
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/deployments` },
      ],
    }),
    getRepositoryStats: builder.query<
      RepositoryStats,
      { owner: string; repo: string }
    >({
      query: ({ owner, repo }) => `/api/repo/${owner}/${repo}/stats`,
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/stats` },
      ],
    }),
    listAliases: builder.query<
      AliasesResponse,
      { owner: string; repo: string }
    >({
      query: ({ owner, repo }) => `/api/repo/${owner}/${repo}/aliases`,
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/aliases` },
      ],
    }),
    createAlias: builder.mutation<
      AliasDetail,
      { owner: string; repo: string; data: CreateAliasRequest }
    >({
      query: ({ owner, repo, data }) => ({
        url: `/api/repo/${owner}/${repo}/aliases`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/aliases` },
        { type: 'Asset', id: `${owner}/${repo}/refs` },
        { type: 'Asset', id: `${owner}/${repo}/stats` },
      ],
    }),
    updateAlias: builder.mutation<
      AliasDetail,
      { owner: string; repo: string; aliasName: string; data: UpdateAliasRequest }
    >({
      query: ({ owner, repo, aliasName, data }) => ({
        url: `/api/repo/${owner}/${repo}/aliases/${aliasName}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/aliases` },
        { type: 'Asset', id: `${owner}/${repo}/refs` },
      ],
    }),
    deleteAlias: builder.mutation<
      void,
      { owner: string; repo: string; aliasName: string }
    >({
      query: ({ owner, repo, aliasName }) => ({
        url: `/api/repo/${owner}/${repo}/aliases/${aliasName}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/aliases` },
        { type: 'Asset', id: `${owner}/${repo}/refs` },
        { type: 'Asset', id: `${owner}/${repo}/stats` },
      ],
    }),
    getCommitDetails: builder.query<
      CommitDetailsResponse,
      { owner: string; repo: string; commitSha: string }
    >({
      query: ({ owner, repo, commitSha }) =>
        `/api/repo/${owner}/${repo}/${commitSha}/details`,
      providesTags: (_result, _error, { owner, repo, commitSha }) => [
        { type: 'Asset', id: `${owner}/${repo}/${commitSha}/details` },
      ],
    }),

    deleteCommit: builder.mutation<DeleteCommitResponse, DeleteCommitRequest>({
      query: ({ owner, repo, commitSha }) => ({
        url: `/api/deployments/commit/${owner}/${repo}/${commitSha}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Asset', id: `${owner}/${repo}/deployments` },
        { type: 'Asset', id: `${owner}/${repo}/refs` },
        { type: 'Asset', id: `${owner}/${repo}/stats` },
      ],
    }),

    // Phase B5: Alias visibility endpoints
    getAliasVisibility: builder.query<
      AliasVisibilityInfo,
      { projectId: string; aliasName: string }
    >({
      query: ({ projectId, aliasName }) =>
        `/api/aliases/${projectId}/${aliasName}/visibility`,
      providesTags: (_result, _error, { projectId, aliasName }) => [
        { type: 'Asset', id: `alias-visibility-${projectId}-${aliasName}` },
      ],
    }),

    updateAliasVisibility: builder.mutation<
      AliasVisibilityInfo,
      { projectId: string; aliasName: string; data: UpdateAliasVisibilityRequest }
    >({
      query: ({ projectId, aliasName, data }) => ({
        url: `/api/aliases/${projectId}/${aliasName}/visibility`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId, aliasName }) => [
        { type: 'Asset', id: `alias-visibility-${projectId}-${aliasName}` },
      ],
    }),
  }),
});

// Path Preferences types
export interface PathPreferenceResponse {
  id?: number;
  filepath: string;
  spaMode: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Path Preferences API
export const pathPreferencesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPathPreference: builder.query<
      PathPreferenceResponse,
      { owner: string; repo: string; filepath: string }
    >({
      query: ({ owner, repo, filepath }) => ({
        url: `/api/repos/${owner}/${repo}/path-preferences?filepath=${encodeURIComponent(filepath)}`,
      }),
      providesTags: (_result, _error, { owner, repo, filepath }) => [
        { type: 'PathPreference', id: `${owner}/${repo}:${filepath}` },
      ],
    }),

    updatePathPreference: builder.mutation<
      PathPreferenceResponse,
      { owner: string; repo: string; filepath: string; spaMode: boolean }
    >({
      query: ({ owner, repo, filepath, spaMode }) => ({
        url: `/api/repos/${owner}/${repo}/path-preferences?filepath=${encodeURIComponent(filepath)}`,
        method: 'PUT',
        body: { spaMode },
      }),
      invalidatesTags: (_result, _error, { owner, repo, filepath }) => [
        { type: 'PathPreference', id: `${owner}/${repo}:${filepath}` },
      ],
      // Optimistic update for instant feedback
      async onQueryStarted({ owner, repo, filepath, spaMode }, { dispatch, queryFulfilled }) {
        const patchResult = dispatch(
          pathPreferencesApi.util.updateQueryData(
            'getPathPreference',
            { owner, repo, filepath },
            (draft) => {
              draft.spaMode = spaMode;
            },
          ),
        );
        try {
          await queryFulfilled;
        } catch {
          patchResult.undo();
        }
      },
    }),

    deletePathPreference: builder.mutation<
      void,
      { owner: string; repo: string; filepath: string }
    >({
      query: ({ owner, repo, filepath }) => ({
        url: `/api/repos/${owner}/${repo}/path-preferences?filepath=${encodeURIComponent(filepath)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo, filepath }) => [
        { type: 'PathPreference', id: `${owner}/${repo}:${filepath}` },
      ],
    }),
  }),
});

export const {
  useGetFileTreeQuery,
  useGetRepositoryRefsQuery,
  useGetDeploymentsQuery,
  useGetRepositoryStatsQuery,
  useListAliasesQuery,
  useCreateAliasMutation,
  useUpdateAliasMutation,
  useDeleteAliasMutation,
  useGetCommitDetailsQuery,
  useDeleteCommitMutation,
  // Phase B5: Alias visibility
  useGetAliasVisibilityQuery,
  useUpdateAliasVisibilityMutation,
} = repoApi;

// Path Preferences hooks
export const {
  useGetPathPreferenceQuery,
  useUpdatePathPreferenceMutation,
  useDeletePathPreferenceMutation,
} = pathPreferencesApi;
