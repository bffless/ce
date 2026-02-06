import { api } from './api';

// Sidebar repository (minimal data)
export interface SidebarRepository {
  id: string;
  owner: string;
  name: string;
  permissionType: 'owner' | 'direct' | 'group';
  role: string;
}

export interface GetMyRepositoriesResponse {
  total: number;
  repositories: SidebarRepository[];
}

// Feed repository (full data)
export interface RepositoryStats {
  deploymentCount: number;
  storageBytes: number;
  storageMB: number;
  lastDeployedAt: string | null;
}

export interface FeedRepository {
  id: string;
  owner: string;
  name: string;
  displayName: string | null;
  description: string | null;
  isPublic: boolean;
  permissionType: 'owner' | 'direct' | 'group' | 'public';
  role: string | null;
  stats: RepositoryStats;
  createdAt: string;
  updatedAt: string;
}

export interface GetRepositoryFeedResponse {
  page: number;
  limit: number;
  total: number;
  repositories: FeedRepository[];
}

export const repositoriesApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Sidebar: My repositories
    getMyRepositories: build.query<GetMyRepositoriesResponse, void>({
      query: () => '/api/repositories/mine',
      providesTags: ['Repository'],
    }),

    // Main content: Repository feed
    getRepositoryFeed: build.query<
      GetRepositoryFeedResponse,
      {
        page?: number;
        limit?: number;
        search?: string;
        sortBy?: 'updatedAt' | 'createdAt' | 'name';
        order?: 'asc' | 'desc';
      }
    >({
      query: (params) => ({
        url: '/api/repositories/feed',
        params,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.repositories.map(({ id }) => ({ type: 'Repository' as const, id })),
              { type: 'Repository', id: 'FEED' },
            ]
          : [{ type: 'Repository', id: 'FEED' }],
    }),
  }),
});

export const {
  useGetMyRepositoriesQuery,
  useGetRepositoryFeedQuery,
} = repositoriesApi;
