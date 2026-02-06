import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Eye, EyeOff, Home, CheckCircle2 } from 'lucide-react';
import { useResetPasswordMutation } from '@/services/authApi';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

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

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const token = searchParams.get('token');

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const password = form.watch('password');
  const passwordStrength = useMemo(() => {
    if (!password) return null;
    return calculatePasswordStrength(password);
  }, [password]);

  const onSubmit = async (data: ResetPasswordFormValues) => {
    if (!token) {
      toast({
        title: 'Invalid link',
        description: 'No reset token found in the URL.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await resetPassword({
        token,
        password: data.password,
      }).unwrap();

      setResetSuccess(true);

      toast({
        title: 'Password reset successful',
        description: result.message,
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (error: any) {
      let errorMessage = 'Failed to reset password. Please try again.';

      if (error?.data?.message) {
        errorMessage = error.data.message;
      }

      // Check for specific errors
      if (errorMessage.toLowerCase().includes('expired')) {
        errorMessage = 'This reset link has expired. Please request a new one.';
      } else if (errorMessage.toLowerCase().includes('invalid')) {
        errorMessage = 'This reset link is invalid. Please request a new one.';
      }

      toast({
        title: 'Reset failed',
        description: errorMessage,
        variant: 'destructive',
      });

      // Clear password fields on error
      form.reset();
    }
  };

  // Handle missing or invalid token
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Button variant="ghost" onClick={() => navigate('/')} className="mb-4 gap-2">
              <Home className="h-4 w-4" />
              <span className="font-semibold">Asset Host</span>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Invalid Reset Link</CardTitle>
              <CardDescription>
                This password reset link is invalid or missing a token.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  The password reset link is not valid. Please request a new password reset link.
                </AlertDescription>
              </Alert>

              <Button className="w-full" onClick={() => navigate('/forgot-password')}>
                Request New Reset Link
              </Button>

              <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Button variant="ghost" onClick={() => navigate('/')} className="mb-4 gap-2">
            <Home className="h-4 w-4" />
            <span className="font-semibold">Asset Host</span>
          </Button>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Set New Password</CardTitle>
            <CardDescription>
              {resetSuccess
                ? 'Your password has been successfully reset'
                : 'Enter your new password below'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {resetSuccess ? (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription>
                    Your password has been successfully reset. You can now sign in with your new
                    password.
                  </AlertDescription>
                </Alert>

                <p className="text-sm text-muted-foreground">
                  Redirecting to login page in 3 seconds...
                </p>

                <Button className="w-full" onClick={() => navigate('/login')}>
                  Go to Login
                </Button>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? 'text' : 'password'}
                              placeholder="Enter your new password"
                              autoComplete="new-password"
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
                        {passwordStrength && (
                          <FormDescription className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all ${passwordStrength.color}`}
                                  style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium">{passwordStrength.label}</span>
                            </div>
                            <p className="text-xs">
                              Use at least 8 characters with a mix of uppercase, lowercase, numbers,
                              and symbols.
                            </p>
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm New Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? 'text' : 'password'}
                              placeholder="Confirm your new password"
                              autoComplete="new-password"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              aria-label={
                                showConfirmPassword ? 'Hide password' : 'Show password'
                              }
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

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Resetting password...' : 'Reset Password'}
                  </Button>

                  <div className="text-center text-sm text-muted-foreground">
                    Remember your password?{' '}
                    <Button
                      variant="link"
                      className="px-0 h-auto font-medium"
                      onClick={() => navigate('/login')}
                    >
                      Sign in
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
