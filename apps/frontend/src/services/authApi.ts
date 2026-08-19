import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'member';
}

export interface SessionInfo {
  session: {
    userId: string;
    handle: string;
  };
  user: User | null;
  emailVerified?: boolean;
  emailVerificationRequired?: boolean;
}

export interface SignInDto {
  email: string;
  password: string;
  projectInviteToken?: string;
}

export interface SignUpDto {
  email: string;
  password: string;
  redirect?: string;
  projectInviteToken?: string;
}

export interface SignInResponse {
  message: string;
  user: User;
}

export interface SignUpResponse {
  message: string;
  user: {
    id: string;
    email: string;
  };
  emailVerificationRequired?: boolean;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  password: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface CheckEmailDto {
  email: string;
}

export interface CheckEmailResponse {
  existsInAuth: boolean;
  existsInWorkspace: boolean;
}

export interface RegistrationStatusResponse {
  registrationEnabled: boolean;
  allowPublicSignups: boolean;
  /**
   * Whether built-in email/password sign-in and registration are enabled.
   * When false the workspace is OIDC-only and the password form is hidden.
   */
  emailPasswordEnabled: boolean;
  requireTosAcceptance: boolean;
  tosUrl: string;
}

export interface SendVerificationEmailResponse {
  message: string;
  alreadyVerified?: boolean;
}

export interface VerifyEmailResponse {
  message: string;
}

export interface LoginMethodsResponse {
  hasPassword: boolean;
  hasGoogle?: boolean;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  message: string;
}

export type OAuthProviderKind = 'google' | 'okta' | 'azure-ad' | 'oidc';

export interface OAuthProvider {
  id: string;
  kind: OAuthProviderKind;
  displayName: string;
}

export interface OAuthProvidersResponse {
  providers: OAuthProvider[];
}

export interface OAuthAuthUrlResponse {
  url: string;
  pkceCodeVerifier?: string;
}

export interface OAuthCallbackDto {
  providerId: string;
  code: string;
  redirectUrl: string;
  pkceCodeVerifier?: string;
  projectInviteToken?: string;
}

export interface OAuthCallbackResponse {
  message: string;
  user: User;
  createdNewUser: boolean;
}

export const authApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSession: builder.query<SessionInfo, void>({
      query: () => '/api/auth/session',
      providesTags: ['User'],
    }),

    signIn: builder.mutation<SignInResponse, SignInDto>({
      query: (credentials) => ({
        url: '/api/auth/signin',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['User'],
    }),

    signUp: builder.mutation<SignUpResponse, SignUpDto>({
      query: (credentials) => ({
        url: '/api/auth/signup',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['User'],
    }),

    checkEmail: builder.mutation<CheckEmailResponse, CheckEmailDto>({
      query: (data) => ({
        url: '/api/auth/check-email',
        method: 'POST',
        body: data,
      }),
    }),

    signOut: builder.mutation<{ status: string }, void>({
      query: () => ({
        url: '/api/auth/signout',
        method: 'POST',
      }),
      invalidatesTags: ['User'],
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          // Manually reset the session cache to null after successful logout
          dispatch(
            authApi.util.updateQueryData('getSession', undefined, () => ({
              session: { userId: '', handle: '' },
              user: null,
              emailVerified: undefined,
              emailVerificationRequired: undefined,
            })),
          );
        } catch {
          // If logout fails, don't update cache
        }
      },
    }),

    forgotPassword: builder.mutation<ForgotPasswordResponse, ForgotPasswordDto>({
      query: (data) => ({
        url: '/api/auth/forgot-password',
        method: 'POST',
        body: data,
      }),
    }),

    resetPassword: builder.mutation<ResetPasswordResponse, ResetPasswordDto>({
      query: (data) => ({
        url: '/api/auth/reset-password',
        method: 'POST',
        body: data,
      }),
    }),

    getRegistrationStatus: builder.query<RegistrationStatusResponse, void>({
      query: () => '/api/auth/registration-status',
    }),

    sendVerificationEmail: builder.mutation<
      SendVerificationEmailResponse,
      { redirect?: string } | void
    >({
      query: (data) => ({
        url: '/api/auth/send-verification-email',
        method: 'POST',
        body: data || {},
      }),
    }),

    verifyEmail: builder.mutation<VerifyEmailResponse, { token: string }>({
      query: (data) => ({
        url: '/api/auth/verify-email',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['User'],
    }),

    getLoginMethods: builder.query<LoginMethodsResponse, void>({
      // User-scoped (returns the current user's linked methods, used by the
      // change-password card). The site-capability endpoint at the same name
      // moved here when /api/auth/login-methods was reclaimed for the public
      // AuthDialog probe.
      query: () => '/api/auth/me/login-methods',
    }),

    changePassword: builder.mutation<ChangePasswordResponse, ChangePasswordDto>({
      query: (data) => ({
        url: '/api/auth/change-password',
        method: 'POST',
        body: data,
      }),
    }),

    getOAuthProviders: builder.query<OAuthProvidersResponse, void>({
      query: () => '/api/auth/oauth/providers',
    }),

    getOAuthUrl: builder.query<OAuthAuthUrlResponse, { providerId: string; redirectUrl: string }>({
      query: ({ providerId, redirectUrl }) =>
        `/api/auth/oauth/${encodeURIComponent(providerId)}/url?redirectUrl=${encodeURIComponent(redirectUrl)}`,
    }),

    oauthCallback: builder.mutation<OAuthCallbackResponse, OAuthCallbackDto>({
      query: ({ providerId, ...body }) => ({
        url: `/api/auth/oauth/${encodeURIComponent(providerId)}/callback`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['User'],
    }),
  }),
});

export const {
  useGetSessionQuery,
  useCheckEmailMutation,
  useSignInMutation,
  useSignUpMutation,
  useSignOutMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useGetRegistrationStatusQuery,
  useSendVerificationEmailMutation,
  useVerifyEmailMutation,
  useGetLoginMethodsQuery,
  useChangePasswordMutation,
  useGetOAuthProvidersQuery,
  useLazyGetOAuthUrlQuery,
  useOauthCallbackMutation,
} = authApi;
