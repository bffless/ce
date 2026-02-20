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
}

export interface SignUpDto {
  email: string;
  password: string;
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
            }))
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

    sendVerificationEmail: builder.mutation<SendVerificationEmailResponse, void>({
      query: () => ({
        url: '/api/auth/send-verification-email',
        method: 'POST',
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
} = authApi;
