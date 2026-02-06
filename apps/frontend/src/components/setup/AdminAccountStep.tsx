import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import {
  useInitializeMutation,
  useCheckEmailMutation,
  useAdoptExistingUserMutation,
  useAdoptSessionUserMutation,
  useGetSetupStatusQuery,
} from '@/services/setupApi';
import { useGetSessionQuery, useSignOutMutation } from '@/services/authApi';
import { nextWizardStep, setAdminCredentials, setWizardError } from '@/store/slices/setupSlice';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle, User, LogOut } from 'lucide-react';

type AuthMode = 'create' | 'signin';
type EmailStatus = 'idle' | 'checking' | 'valid' | 'exists-can-adopt' | 'exists-in-workspace' | 'error';

export function AdminAccountStep() {
  const dispatch = useDispatch();
  const { adminEmail, adminPassword } = useSelector(
    (state: RootState) => state.setup.wizard
  );

  // Read onboarding token from URL query params
  const [searchParams] = useSearchParams();
  const onboardingToken = useMemo(() => searchParams.get('token') || undefined, [searchParams]);

  // Check for existing session
  const { data: sessionData, isLoading: isSessionLoading } = useGetSessionQuery();
  const [signOut, { isLoading: isSigningOut }] = useSignOutMutation();

  // Check if admin already exists (for back navigation)
  const { data: setupStatus, isLoading: isStatusLoading } = useGetSetupStatusQuery();

  const [authMode, setAuthMode] = useState<AuthMode>('create');
  const [email, setEmail] = useState(adminEmail);
  const [password, setPassword] = useState(adminPassword);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle');
  const [emailMessage, setEmailMessage] = useState<string>('');

  const [initialize, { isLoading: isInitializing }] = useInitializeMutation();
  const [checkEmail] = useCheckEmailMutation();
  const [adoptExistingUser, { isLoading: isAdopting }] = useAdoptExistingUserMutation();
  const [adoptSessionUser, { isLoading: isAdoptingSession }] = useAdoptSessionUserMutation();

  const isLoading = isInitializing || isAdopting || isAdoptingSession;

  // Check if user is already logged in
  const isLoggedIn = sessionData?.user && sessionData.session?.userId;
  const loggedInEmail = sessionData?.user?.email;

  // Ref for debounce timeout
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Function to check email status
  const performEmailCheck = useCallback(
    async (emailValue: string) => {
      if (!emailValue || !emailValue.includes('@')) {
        setEmailStatus('idle');
        setEmailMessage('');
        return;
      }

      setEmailStatus('checking');
      try {
        const result = await checkEmail({ email: emailValue }).unwrap();
        if (result.existsInWorkspace) {
          setEmailStatus('exists-in-workspace');
          setEmailMessage(result.message || 'User already exists in this workspace.');
        } else if (result.canAdopt) {
          setEmailStatus('exists-can-adopt');
          setEmailMessage('Account found. Sign in to become admin of this workspace.');
          // Auto-switch to sign-in mode when existing account is detected
          setAuthMode('signin');
        } else if (result.existsInAuth && !result.canAdopt) {
          setEmailStatus('error');
          setEmailMessage(result.message || 'Cannot use this account.');
        } else {
          setEmailStatus('valid');
          setEmailMessage('');
        }
      } catch {
        setEmailStatus('idle');
        setEmailMessage('');
      }
    },
    [checkEmail]
  );

  // Debounced email check
  const debouncedCheckEmail = useCallback(
    (emailValue: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        performEmailCheck(emailValue);
      }, 500);
    },
    [performEmailCheck]
  );

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Check email on change
  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newEmail = e.target.value;
      setEmail(newEmail);
      setEmailStatus('idle');
      setEmailMessage('');
      debouncedCheckEmail(newEmail);
    },
    [debouncedCheckEmail]
  );

  // Check initial email on mount if one was stored
  useEffect(() => {
    if (adminEmail && adminEmail.includes('@')) {
      performEmailCheck(adminEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut().unwrap();
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const handleUseCurrentAccount = async () => {
    if (!loggedInEmail) return;

    try {
      dispatch(setWizardError(null));
      // Use the session-based adoption - no password required
      const result = await adoptSessionUser({ token: onboardingToken }).unwrap();
      dispatch(setAdminCredentials({ email: result.email, password: '' }));
      dispatch(nextWizardStep());
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to use current account'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!email || !password) {
      dispatch(setWizardError('Email and password are required'));
      return;
    }

    if (password.length < 8) {
      dispatch(setWizardError('Password must be at least 8 characters'));
      return;
    }

    // For create mode, require password confirmation
    if (authMode === 'create' && password !== confirmPassword) {
      dispatch(setWizardError('Passwords do not match'));
      return;
    }

    try {
      dispatch(setWizardError(null));

      if (authMode === 'signin' || emailStatus === 'exists-can-adopt') {
        // Sign in to adopt as admin
        await adoptExistingUser({ email, password, token: onboardingToken }).unwrap();
      } else {
        // Create new account
        await initialize({ email, password, token: onboardingToken }).unwrap();
      }

      dispatch(setAdminCredentials({ email, password }));
      dispatch(nextWizardStep());
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to create admin account'));
    }
  };

  const getEmailStatusIcon = () => {
    switch (emailStatus) {
      case 'checking':
        return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
      case 'valid':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'exists-can-adopt':
        return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case 'exists-in-workspace':
      case 'error':
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      default:
        return null;
    }
  };

  const isSubmitDisabled =
    isLoading ||
    emailStatus === 'exists-in-workspace' ||
    emailStatus === 'error' ||
    emailStatus === 'checking';

  // Show loading state while checking session and status
  if (isSessionLoading || isStatusLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If admin already exists (user navigated back), show continue option
  if (setupStatus?.hasAdminUser && !isLoggedIn) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">Admin Account Created</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            An admin account has already been created for this workspace.
          </p>
        </div>

        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Step Completed
            </p>
            <p className="text-xs text-green-700 dark:text-green-300">
              You can continue to the next step or sign in to make changes.
            </p>
          </div>
        </div>

        <Button onClick={() => dispatch(nextWizardStep())} className="w-full">
          Continue to Next Step
        </Button>
      </div>
    );
  }

  // Show logged-in user option
  if (isLoggedIn && loggedInEmail) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">Welcome Back!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            You're already signed in. Would you like to use this account as admin?
          </p>
        </div>

        <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{loggedInEmail}</p>
            <p className="text-xs text-muted-foreground">Current account</p>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            onClick={handleUseCurrentAccount}
            disabled={isAdoptingSession}
            className="w-full"
          >
            {isAdoptingSession ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting Up...
              </>
            ) : (
              'Use This Account as Admin'
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={isSigningOut || isAdoptingSession}
            className="w-full"
          >
            {isSigningOut ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing Out...
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4 mr-2" />
                Use Different Account
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex gap-2 p-1 bg-muted rounded-lg">
        <button
          type="button"
          onClick={() => setAuthMode('create')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            authMode === 'create'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Create Account
        </button>
        <button
          type="button"
          onClick={() => setAuthMode('signin')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            authMode === 'signin'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Sign In
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">
            {authMode === 'signin' ? 'Sign In as Admin' : 'Create Admin Account'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {authMode === 'signin'
              ? 'Sign in with an existing account to become admin of this workspace.'
              : 'Create a new account to be the first administrator.'}
          </p>
        </div>

        <div>
          <Label htmlFor="email">Email address</Label>
          <div className="relative">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={handleEmailChange}
              placeholder="admin@example.com"
              required
              className="mt-1 pr-10"
              autoComplete="email"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-0.5">
              {getEmailStatusIcon()}
            </div>
          </div>
          {emailMessage && (
            <p
              className={`mt-1 text-sm ${
                emailStatus === 'exists-in-workspace' || emailStatus === 'error'
                  ? 'text-destructive'
                  : emailStatus === 'exists-can-adopt'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-muted-foreground'
              }`}
            >
              {emailMessage}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={authMode === 'signin' ? 'Enter your password' : 'Minimum 8 characters'}
            required
            minLength={8}
            className="mt-1"
            autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
          />
        </div>

        {authMode === 'create' && (
          <div>
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              className="mt-1"
              autoComplete="new-password"
            />
          </div>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {authMode === 'signin' ? 'Signing In...' : 'Creating Account...'}
            </>
          ) : authMode === 'signin' ? (
            'Sign In & Continue'
          ) : (
            'Create Account & Continue'
          )}
        </Button>
      </form>
    </div>
  );
}
