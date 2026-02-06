import { api } from './api';

export interface ShareLink {
  id: string;
  projectId: string | null;
  domainMappingId: string | null;
  token: string;
  label: string | null;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShareLinkDto {
  projectId?: string;
  domainMappingId?: string;
  label?: string;
  expiresAt?: string | null;
}

export interface UpdateShareLinkDto {
  label?: string;
  isActive?: boolean;
  expiresAt?: string | null;
}

export const shareLinksApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getShareLinksByProject: builder.query<ShareLink[], string>({
      query: (projectId) => `/api/share-links/project/${projectId}`,
      transformResponse: (response: { shareLinks: ShareLink[] }) =>
        response.shareLinks,
      providesTags: (result, _error, projectId) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'ShareLink' as const, id })),
              { type: 'ShareLink', id: `PROJECT-${projectId}` },
            ]
          : [{ type: 'ShareLink', id: `PROJECT-${projectId}` }],
    }),
    getShareLinksByDomain: builder.query<ShareLink[], string>({
      query: (domainMappingId) =>
        `/api/share-links/domain/${domainMappingId}`,
      transformResponse: (response: { shareLinks: ShareLink[] }) =>
        response.shareLinks,
      providesTags: (result, _error, domainMappingId) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'ShareLink' as const, id })),
              { type: 'ShareLink', id: `DOMAIN-${domainMappingId}` },
            ]
          : [{ type: 'ShareLink', id: `DOMAIN-${domainMappingId}` }],
    }),
    createShareLink: builder.mutation<ShareLink, CreateShareLinkDto>({
      query: (dto) => ({
        url: '/api/share-links',
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, dto) => {
        const tags: { type: 'ShareLink'; id: string }[] = [];
        if (dto.projectId)
          tags.push({ type: 'ShareLink', id: `PROJECT-${dto.projectId}` });
        if (dto.domainMappingId)
          tags.push({
            type: 'ShareLink',
            id: `DOMAIN-${dto.domainMappingId}`,
          });
        return tags;
      },
    }),
    updateShareLink: builder.mutation<
      ShareLink,
      { id: string; updates: UpdateShareLinkDto; projectId?: string; domainMappingId?: string }
    >({
      query: ({ id, updates }) => ({
        url: `/api/share-links/${id}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { id, projectId, domainMappingId }) => {
        const tags: { type: 'ShareLink'; id: string }[] = [
          { type: 'ShareLink', id },
        ];
        if (projectId)
          tags.push({ type: 'ShareLink', id: `PROJECT-${projectId}` });
        if (domainMappingId)
          tags.push({
            type: 'ShareLink',
            id: `DOMAIN-${domainMappingId}`,
          });
        return tags;
      },
    }),
    deleteShareLink: builder.mutation<
      void,
      { id: string; projectId?: string; domainMappingId?: string }
    >({
      query: ({ id }) => ({
        url: `/api/share-links/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { id, projectId, domainMappingId }) => {
        const tags: { type: 'ShareLink'; id: string }[] = [
          { type: 'ShareLink', id },
        ];
        if (projectId)
          tags.push({ type: 'ShareLink', id: `PROJECT-${projectId}` });
        if (domainMappingId)
          tags.push({
            type: 'ShareLink',
            id: `DOMAIN-${domainMappingId}`,
          });
        return tags;
      },
    }),
    regenerateShareLinkToken: builder.mutation<
      ShareLink,
      { id: string; projectId?: string; domainMappingId?: string }
    >({
      query: ({ id }) => ({
        url: `/api/share-links/${id}/regenerate`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, { id, projectId, domainMappingId }) => {
        const tags: { type: 'ShareLink'; id: string }[] = [
          { type: 'ShareLink', id },
        ];
        if (projectId)
          tags.push({ type: 'ShareLink', id: `PROJECT-${projectId}` });
        if (domainMappingId)
          tags.push({
            type: 'ShareLink',
            id: `DOMAIN-${domainMappingId}`,
          });
        return tags;
      },
    }),
  }),
});

export const {
  useGetShareLinksByProjectQuery,
  useGetShareLinksByDomainQuery,
  useCreateShareLinkMutation,
  useUpdateShareLinkMutation,
  useDeleteShareLinkMutation,
  useRegenerateShareLinkTokenMutation,
} = shareLinksApi;
