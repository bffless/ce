import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Eye, EyeOff, Mail, CheckCircle, Info } from 'lucide-react';
import logoSvg from '@/assets/logo-circle-wire-text.svg';
import { useSignUpMutation, useCheckEmailMutation, useGetSessionQuery, useGetRegistrationStatusQuery } from '@/services/authApi';
import { useValidateInvitationTokenQuery } from '@/services/invitationsApi';
import { useToast } from '@/hooks/use-toast';
import { validateRedirectUrl } from '@/lib/validateRedirectUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';

const createSignupSchema = (authMode: 'create' | 'signin') =>
  z.object({
    email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    acceptTerms: z.boolean().refine((val) => authMode === 'signin' || val === true, {
      message: 'You must accept the terms of service',
    }),
  }).refine((data) => authMode === 'signin' || data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type SignupFormValues = z.infer<ReturnType<typeof createSignupSchema>>;

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

function calculatePasswordStrength(password: string): PasswordStrength {
  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) {
    return { score, label: 'Weak', color: 'bg-red-500' };
  } else if (score === 2) {
    return { score, label: 'Fair', color: 'bg-orange-500' };
  } else if (score === 3) {
    return { score, label: 'Good', color: 'bg-yellow-500' };
  } else {
    return { score, label: 'Strong', color: 'bg-green-500' };
  }
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [signUp, { isLoading }] = useSignUpMutation();
  const [checkEmail] = useCheckEmailMutation();
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const { data: registrationStatus, isLoading: isLoadingRegistration } = useGetRegistrationStatusQuery();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'create' | 'signin'>('create');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate redirect URL to prevent open redirect attacks
  const redirectTo = validateRedirectUrl(searchParams.get('redirect'));

  // Extract invite token from redirect URL if present (e.g., /invite/{token})
  const inviteToken = useMemo(() => {
    const redirect = searchParams.get('redirect');
    if (!redirect) return null;
    const match = redirect.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    return match ? match[1] : null;
  }, [searchParams]);

  // Validate the invitation token if present
  const { data: invitationData, isLoading: isLoadingInvitation } = useValidateInvitationTokenQuery(
    inviteToken || '',
    { skip: !inviteToken }
  );

  // Check if signups are allowed - either public signups OR valid invitation
  const hasValidInvitation = inviteToken && invitationData?.valid;
  const signupsAllowed = registrationStatus?.registrationEnabled &&
    (registrationStatus?.allowPublicSignups || hasValidInvitation);

  const signupSchema = useMemo(() => createSignupSchema(authMode), [authMode]);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  const password = form.watch('password');
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    return calculatePasswordStrength(password);
  }, [password]);

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoadingSession && sessionData?.user) {
      navigate(redirectTo);
    }
  }, [isLoadingSession, sessionData, navigate, redirectTo]);

  // Pre-fill email when user has a valid invitation
  useEffect(() => {
    if (invitationData?.valid && invitationData?.email) {
      form.setValue('email', invitationData.email);
    }
  }, [invitationData, form]);

  // Debounced email check for orphaned/existing users
  const performEmailCheck = useCallback(
    async (emailValue: string) => {
      if (!emailValue || !emailValue.includes('@') || !emailValue.includes('.')) {
        setAuthMode('create');
        return;
      }
      try {
        const result = await checkEmail({ email: emailValue }).unwrap();
        if (result.existsInAuth && !result.existsInWorkspace) {
          // Orphaned user: exists in SuperTokens but not in app DB
          setAuthMode('signin');
        } else if (result.existsInWorkspace) {
          // Fully existing user — stay in create mode, message shown in render
          setAuthMode('create');
        } else {
          setAuthMode('create');
        }
      } catch {
        setAuthMode('create');
      }
    },
    [checkEmail],
  );

  const debouncedCheckEmail = useCallback(
    (emailValue: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        performEmailCheck(emailValue);
      }, 500);
    },
    [performEmailCheck],
  );

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Watch email field and trigger debounced check
  const emailValue = form.watch('email');
  useEffect(() => {
    if (!hasValidInvitation && emailValue) {
      debouncedCheckEmail(emailValue);
    } else if (!emailValue) {
      setAuthMode('create');
    }
  }, [emailValue, debouncedCheckEmail, hasValidInvitation]);

  const onSubmit = async (data: SignupFormValues) => {
    // Both modes use signUp — the backend signup endpoint already handles
    // the orphan case (EMAIL_ALREADY_EXISTS_ERROR): it verifies the password
    // via SuperTokens signIn and re-creates the app DB record.
    try {
      const result = await signUp({
        email: data.email,
        password: data.password,
      }).unwrap();

      // If email verification is required, redirect to verify-email page
      if (result.emailVerificationRequired) {
        toast({
          title: 'Account created!',
          description: 'Please check your email to verify your account.',
        });
        navigate('/verify-email');
        return;
      }

      // If user signed up with a valid invitation, the backend already accepted it
      // Go directly to home instead of back to the invite page
      if (hasValidInvitation) {
        toast({
          title: 'Welcome!',
          description: `Your account has been created and you've joined the workspace as ${invitationData?.role}.`,
        });
        navigate('/');
      } else if (authMode === 'signin') {
        toast({
          title: 'Welcome back!',
          description: 'You have been signed in successfully.',
        });
        navigate(redirectTo);
      } else {
        toast({
          title: 'Account created!',
          description: 'Your account has been successfully created.',
        });
        navigate(redirectTo);
      }
    } catch (error: any) {
      let errorMessage = authMode === 'signin'
        ? 'Failed to sign in. Please check your password and try again.'
        : 'Failed to create account. Please try again.';

      if (error?.data?.message) {
        errorMessage = error.data.message;
      }

      toast({
        title: authMode === 'signin' ? 'Sign in failed' : 'Signup failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  if (isLoadingSession || isLoadingRegistration || isLoadingInvitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If public signups are not allowed, show a message
  if (!signupsAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-full"
            >
              <img src={logoSvg} alt="BFFLESS" className="w-48 h-48" />
            </button>
          </div>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold">Registration Unavailable</CardTitle>
              <CardDescription>Public registration is not currently open</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Mail className="h-4 w-4" />
                <AlertTitle>Invitation Required</AlertTitle>
                <AlertDescription>
                  {!registrationStatus?.registrationEnabled
                    ? 'Registration is currently disabled on this platform.'
                    : 'This workspace requires an invitation to join. Please contact an administrator to request access.'}
                </AlertDescription>
              </Alert>

              <div className="text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  Already have an account or invitation?
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate(`/login${searchParams.get('redirect') ? `?redirect=${searchParams.get('redirect')}` : ''}`)}
                >
                  Sign In
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-full"
          >
            <img src={logoSvg} alt="BFFLESS" className="w-48 h-48" />
          </button>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">
              {authMode === 'signin' ? 'Sign In' : 'Create Account'}
            </CardTitle>
            <CardDescription>
              {authMode === 'signin'
                ? 'Sign in with your existing account'
                : 'Create your account to get started'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasValidInvitation && (
              <Alert className="mb-4 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertTitle className="text-green-800 dark:text-green-200">Invitation Accepted</AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-300">
                  You've been invited as <span className="font-medium">{invitationData?.role}</span>. Complete registration to join.
                </AlertDescription>
              </Alert>
            )}
            {authMode === 'signin' && (
              <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertTitle className="text-blue-800 dark:text-blue-200">Account found</AlertTitle>
                <AlertDescription className="text-blue-700 dark:text-blue-300">
                  An account with this email already exists. Sign in to continue.
                </AlertDescription>
              </Alert>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="Enter your email"
                          autoComplete="email"
                          readOnly={!!hasValidInvitation}
                          className={hasValidInvitation ? 'bg-muted' : ''}
                          {...field}
                        />
                      </FormControl>
                      {hasValidInvitation && (
                        <FormDescription>
                          This email is linked to your invitation and cannot be changed.
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder={authMode === 'signin' ? 'Enter your password' : 'Create a password'}
                            autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                            {...field}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      {authMode === 'create' && passwordStrength && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                                style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium min-w-12">
                              {passwordStrength.label}
                            </span>
                          </div>
                          <FormDescription className="text-xs">
                            Use 8+ characters with a mix of letters, numbers & symbols
                          </FormDescription>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {authMode === 'create' && (
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? 'text' : 'password'}
                              placeholder="Confirm your password"
                              autoComplete="new-password"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                            >
                              {showConfirmPassword ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {authMode === 'create' && (
                  <FormField
                    control={form.control}
                    name="acceptTerms"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-normal cursor-pointer">
                            I agree to the{' '}
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={(e) => {
                                e.preventDefault();
                                toast({
                                  title: 'Terms of Service',
                                  description: 'Terms of service page coming soon',
                                });
                              }}
                            >
                              Terms of Service
                            </button>
                          </FormLabel>
                          <FormMessage />
                        </div>
                      </FormItem>
                    )}
                  />
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? (authMode === 'signin' ? 'Signing in...' : 'Creating account...')
                    : (authMode === 'signin' ? 'Sign In' : 'Create Account')}
                </Button>

                <div className="text-center text-sm">
                  {authMode === 'signin' ? (
                    <>
                      Want to use a different email?{' '}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => {
                          setAuthMode('create');
                          form.setValue('email', '');
                          form.setValue('password', '');
                          form.setValue('confirmPassword', '');
                        }}
                      >
                        Start over
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <Link
                        to={`/login${searchParams.get('redirect') ? `?redirect=${searchParams.get('redirect')}` : ''}`}
                        className="text-primary hover:underline font-medium"
                      >
                        Sign in
                      </Link>
                    </>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
