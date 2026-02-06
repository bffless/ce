import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import logoSvg from '@/assets/logo-circle-wire-text.svg';
import { useSignInMutation, useGetSessionQuery } from '@/services/authApi';
import { useGetSetupStatusQuery } from '@/services/setupApi';
import { useToast } from '@/hooks/use-toast';
import { validateRedirectUrl } from '@/lib/validateRedirectUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [signIn, { isLoading }] = useSignInMutation();
  const { data: sessionData, isLoading: isLoadingSession } = useGetSessionQuery();
  const { data: setupStatus, isLoading: isLoadingSetup } = useGetSetupStatusQuery();
  const [showPassword, setShowPassword] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshAttemptedRef = useRef(false);

  // Validate redirect URL to prevent open redirect attacks
  const redirectTo = validateRedirectUrl(searchParams.get('redirect'));
  const shouldTryRefresh = searchParams.get('tryRefresh') === 'true';

  // Attempt session refresh when redirected from a private deployment
  // This handles the case where access token expired but refresh token is still valid
  useEffect(() => {
    if (!shouldTryRefresh || refreshAttemptedRef.current) {
      return;
    }

    // Mark as attempted to prevent duplicate calls
    refreshAttemptedRef.current = true;
    setIsRefreshing(true);

    // Use native fetch to call refresh endpoint directly
    // RTK Query's reauth wrapper skips refresh on login page
    fetch('/api/auth/session/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (response) => {
        if (response.ok) {
          // Session refreshed successfully - redirect to target
          // The new access token cookie is now set
          window.location.href = redirectTo;
        } else {
          // Refresh failed - show login form
          // Remove tryRefresh param to prevent loops
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('tryRefresh');
          setSearchParams(newParams, { replace: true });
          setIsRefreshing(false);
        }
      })
      .catch(() => {
        // Network error - show login form
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('tryRefresh');
        setSearchParams(newParams, { replace: true });
        setIsRefreshing(false);
      });
  }, [shouldTryRefresh, redirectTo, searchParams, setSearchParams]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  });

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoadingSession && sessionData?.user) {
      navigate(redirectTo);
    }
  }, [isLoadingSession, sessionData, navigate, redirectTo]);

  // Redirect to setup if not complete
  if (!isLoadingSetup && setupStatus && !setupStatus.isSetupComplete) {
    return <Navigate to="/setup" replace />;
  }

  const onSubmit = async (data: LoginFormValues) => {
    try {
      await signIn({
        email: data.email,
        password: data.password,
      }).unwrap();

      toast({
        title: 'Welcome back!',
        description: 'You have successfully logged in.',
      });

      navigate(redirectTo);
    } catch (error: any) {
      const errorMessage = error?.data?.message || 'Invalid email or password. Please try again.';

      toast({
        title: 'Login failed',
        description: errorMessage,
        variant: 'destructive',
      });

      // Clear password on error
      form.setValue('password', '');
    }
  };

  if (isLoadingSession || isLoadingSetup || isRefreshing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">
          {isRefreshing ? 'Restoring session...' : 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-full"
          >
            <img src={logoSvg} alt="BFFLess" className="w-48 h-48" />
          </button>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
            <CardDescription>Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent>
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
                          {...field}
                        />
                      </FormControl>
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
                            placeholder="Enter your password"
                            autoComplete="current-password"
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
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center justify-between">
                  <FormField
                    control={form.control}
                    name="rememberMe"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="text-sm font-normal cursor-pointer">
                          Remember me
                        </FormLabel>
                      </FormItem>
                    )}
                  />

                  <Link
                    to="/forgot-password"
                    className="px-0 text-sm text-primary hover:underline font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>

                <div className="text-center text-sm">
                  Don't have an account?{' '}
                  <Link
                    to={`/signup${searchParams.get('redirect') ? `?redirect=${searchParams.get('redirect')}` : ''}`}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign up
                  </Link>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
