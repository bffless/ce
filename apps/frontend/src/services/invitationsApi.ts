import { api } from './api';

// ============================================================================
// Types
// ============================================================================

export interface Invitation {
  id: string;
  email: string;
  role: string;
  token?: string;
  inviteUrl?: string;
  invitedBy?: string;
  expiresAt: string;
  isExpired: boolean;
  acceptedAt?: string;
  acceptedUserId?: string;
  createdAt: string;
}

export type InvitationRole = 'admin' | 'user' | 'member';

export interface CreateInvitationDto {
  email: string;
  role?: InvitationRole;
  expiresInHours?: number;
}

export interface ListInvitationsQuery {
  pendingOnly?: boolean;
  email?: string;
}

export interface CreateInvitationResponse {
  message: string;
  invitation: Invitation;
}

export interface ListInvitationsResponse {
  invitations: Invitation[];
}

export interface DeleteInvitationResponse {
  message: string;
  invitationId: string;
}

export interface ValidateInvitationResponse {
  valid: boolean;
  email?: string;
  role?: string;
  error?: string;
}

export interface AcceptInvitationResponse {
  message: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

// ============================================================================
// API Endpoints
// ============================================================================

export const invitationsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Admin endpoints
    createInvitation: builder.mutation<CreateInvitationResponse, CreateInvitationDto>({
      query: (data) => ({
        url: '/api/admin/invitations',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Invitation'],
    }),

    listInvitations: builder.query<ListInvitationsResponse, ListInvitationsQuery | void>({
      query: (params) => ({
        url: '/api/admin/invitations',
        params: params || undefined,
      }),
      providesTags: ['Invitation'],
    }),

    getInvitation: builder.query<Invitation, string>({
      query: (id) => `/api/admin/invitations/${id}`,
      providesTags: ['Invitation'],
    }),

    resendInvitation: builder.mutation<CreateInvitationResponse, string>({
      query: (id) => ({
        url: `/api/admin/invitations/${id}/resend`,
        method: 'POST',
      }),
      invalidatesTags: ['Invitation'],
    }),

    deleteInvitation: builder.mutation<DeleteInvitationResponse, string>({
      query: (id) => ({
        url: `/api/admin/invitations/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Invitation'],
    }),

    // Public endpoints (for invitation accept flow)
    validateInvitationToken: builder.query<ValidateInvitationResponse, string>({
      query: (token) => `/api/invitations/${token}`,
    }),

    acceptInvitation: builder.mutation<AcceptInvitationResponse, string>({
      query: (token) => ({
        url: `/api/invitations/${token}/accept`,
        method: 'POST',
      }),
      invalidatesTags: ['User', 'Invitation'],
    }),
  }),
});

export const {
  useCreateInvitationMutation,
  useListInvitationsQuery,
  useGetInvitationQuery,
  useResendInvitationMutation,
  useDeleteInvitationMutation,
  useValidateInvitationTokenQuery,
  useAcceptInvitationMutation,
} = invitationsApi;
