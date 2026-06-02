import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useGetSessionQuery } from '@/services/authApi';
import { useGetSetupStatusQuery } from '@/services/setupApi';
import { useGetWildcardCertificateStatusQuery } from '@/services/domainsApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { useGetMyRepositoriesQuery } from '@/services/repositoriesApi';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { OnboardingModal } from '@/components/setup/onboarding/OnboardingModal';
import { FolderGit2, Settings, Users, UserCog, ShieldAlert, X, ArrowRight, ExternalLink, Globe } from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';

/**
 * HomePage - Welcome page for the admin control panel
 * Requires authentication (enforced by ProtectedRoute in App.tsx)
 * Redirects to /setup if setup is not complete
 * Shows onboarding modal for first-time users
 */
const SSL_BANNER_DISMISSED_KEY = 'ssl-setup-banner-dismissed';

export function HomePage() {
  const { data: setupStatus, isLoading: isSetupLoading } = useGetSetupStatusQuery();
  // Session data is guaranteed by ProtectedRoute, but we still need it for user info
  const { data: sessionData } = useGetSessionQuery();
  const { authLogoUrl, siteName } = useBranding();
  const { hasCompletedOnboarding } = useSelector((state: RootState) => state.setup.onboarding);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Feature flags and wildcard SSL status for banner
  const { isEnabled, isReady: flagsReady } = useFeatureFlags();
  const isBannerEnabled = isEnabled('ENABLE_WILDCARD_SSL_BANNER');
  const isWildcardSslEnabled = isEnabled('ENABLE_WILDCARD_SSL');
  // Skip the query if:
  // - flags aren't ready yet
  // - banner is disabled (no need to check status if we won't show banner)
  // - wildcard SSL feature is disabled (backend will return 403)
  const { data: certStatus } = useGetWildcardCertificateStatusQuery(undefined, {
    skip: !flagsReady || !isBannerEnabled || !isWildcardSslEnabled,
  });

  const [isBannerDismissed, setIsBannerDismissed] = useState(() =>
    localStorage.getItem(SSL_BANNER_DISMISSED_KEY) === 'true'
  );

  const user = sessionData?.user;
  // Show the Repositories card when the user has at least one non-guest repo
  // membership. The backend's /api/repositories/mine already filters out
  // guest-only entries, so total > 0 means there is somewhere to navigate to.
  // Admins always get a result here because the endpoint returns every repo.
  const { data: myRepos } = useGetMyRepositoriesQuery(undefined, { skip: !user });
  const showRepositoriesCard = (myRepos?.total ?? 0) > 0;

  const showSslBanner =
    user?.role === 'admin' &&
    isBannerEnabled &&
    isWildcardSslEnabled &&
    certStatus?.exists === false &&
    !isBannerDismissed;

  const dismissBanner = () => {
    localStorage.setItem(SSL_BANNER_DISMISSED_KEY, 'true');
    setIsBannerDismissed(true);
  };

  // Show onboarding modal if user hasn't completed onboarding
  // Only show for admin role since they can create repos (the modal guides through repo creation)
  useEffect(() => {
    const canCreateRepos = sessionData?.user?.role === 'admin';
    if (sessionData?.user && !hasCompletedOnboarding && canCreateRepos) {
      setShowOnboarding(true);
    }
  }, [sessionData, hasCompletedOnboarding]);

  // Check setup status first - redirect to setup if not complete
  if (!isSetupLoading && setupStatus && !setupStatus.isSetupComplete) {
    return <Navigate to="/setup" replace />;
  }

  // Show loading while checking setup status (auth loading handled by ProtectedRoute)
  if (isSetupLoading) {
    return (
      <div className="min-h-screen bg-[#ede8dd] dark:bg-background">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#ede8dd] dark:bg-background">
      {/* Hero Section */}
      <div className="bg-white dark:bg-card border-b">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="flex-shrink-0">
              <img
                src={authLogoUrl}
                alt={siteName}
                className="w-28 h-28 md:w-36 md:h-36"
              />
            </div>
            <div className="text-center md:text-left">
              <h1 className="text-3xl md:text-4xl font-bold text-[#3a3a3a] dark:text-foreground">
                Welcome{user ? `, ${user.email.split('@')[0]}` : ''}
              </h1>
              <p className="mt-2 text-lg text-[#4a4a4a] dark:text-muted-foreground">
                Admin Control Panel
              </p>
              {window.location.hostname.startsWith('admin.') && (
                <a
                  href={`${window.location.protocol}//${window.location.hostname.replace(/^admin\./, '')}${window.location.port ? `:${window.location.port}` : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-[#d96459] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#c4574d] transition-colors"
                >
                  Visit Site
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {showSslBanner && (
          <Alert className="bg-white border-[#d96459]/30 dark:bg-card dark:border-[#d96459]/50">
            <ShieldAlert className="h-4 w-4 text-[#d96459]" />
            <AlertTitle className="text-[#3a3a3a] dark:text-foreground">
              Wildcard SSL Certificate Required
            </AlertTitle>
            <AlertDescription className="text-[#4a4a4a] dark:text-muted-foreground">
              <p className="mb-2">
                To enable HTTPS for your deployments, you need to configure a wildcard SSL
                certificate. This requires adding DNS TXT records to verify domain ownership.
              </p>
              <div className="flex items-center gap-3">
                <Button asChild size="sm" className="bg-[#d96459] hover:bg-[#c55449] text-white">
                  <Link to="/domains">Configure SSL</Link>
                </Button>
                <button
                  onClick={dismissBanner}
                  className="text-sm text-[#4a4a4a] hover:text-[#3a3a3a] dark:text-muted-foreground dark:hover:text-foreground underline"
                >
                  Dismiss
                </button>
              </div>
            </AlertDescription>
            <button
              onClick={dismissBanner}
              className="absolute top-3 right-3 text-[#4a4a4a] hover:text-[#3a3a3a] dark:text-muted-foreground dark:hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        )}

        {/* Navigation Cards */}
        <div className={`grid gap-4 ${user?.role === 'admin' ? 'md:grid-cols-2 lg:grid-cols-4' : showRepositoriesCard ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {showRepositoriesCard && (
            <Link to="/repo" className="group block">
              <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6 hover:border-[#d96459]/50 hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between">
                  <FolderGit2 className="h-8 w-8 text-[#d96459]" />
                  <ArrowRight className="h-5 w-5 text-[#4a4a4a]/30 group-hover:text-[#d96459] group-hover:translate-x-1 transition-all" />
                </div>
                <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mt-4">
                  Repositories
                </h2>
                <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
                  Manage your repositories and deployments
                </p>
              </div>
            </Link>
          )}

          {user?.role === 'admin' && (
            <Link to="/users" className="group block">
              <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6 hover:border-[#d96459]/50 hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between">
                  <UserCog className="h-8 w-8 text-[#d96459]" />
                  <ArrowRight className="h-5 w-5 text-[#4a4a4a]/30 group-hover:text-[#d96459] group-hover:translate-x-1 transition-all" />
                </div>
                <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mt-4">
                  Users
                </h2>
                <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
                  Manage registered users and roles
                </p>
              </div>
            </Link>
          )}

          {user?.role === 'admin' && (
            <Link to="/groups" className="group block">
              <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6 hover:border-[#d96459]/50 hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between">
                  <Users className="h-8 w-8 text-[#d96459]" />
                  <ArrowRight className="h-5 w-5 text-[#4a4a4a]/30 group-hover:text-[#d96459] group-hover:translate-x-1 transition-all" />
                </div>
                <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mt-4">
                  Groups
                </h2>
                <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
                  Manage user groups and permissions
                </p>
              </div>
            </Link>
          )}

          <Link to="/settings?tab=sites" className="group block">
            <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6 hover:border-[#d96459]/50 hover:shadow-md transition-all duration-200">
              <div className="flex items-start justify-between">
                <Globe className="h-8 w-8 text-[#d96459]" />
                <ArrowRight className="h-5 w-5 text-[#4a4a4a]/30 group-hover:text-[#d96459] group-hover:translate-x-1 transition-all" />
              </div>
              <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mt-4">
                My Sites
              </h2>
              <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
                Sites your BFFless Auth account is a member of
              </p>
            </div>
          </Link>

          <Link to="/settings" className="group block">
            <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6 hover:border-[#d96459]/50 hover:shadow-md transition-all duration-200">
              <div className="flex items-start justify-between">
                <Settings className="h-8 w-8 text-[#d96459]" />
                <ArrowRight className="h-5 w-5 text-[#4a4a4a]/30 group-hover:text-[#d96459] group-hover:translate-x-1 transition-all" />
              </div>
              <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mt-4">
                Settings
              </h2>
              <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
                Manage your account and preferences
              </p>
            </div>
          </Link>
        </div>

        {/* Admin Section */}
        {user?.role === 'admin' && (
          <div className="bg-white dark:bg-card border border-[#3a3a3a]/10 dark:border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-[#3a3a3a] dark:text-foreground mb-4">
              Admin
            </h2>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="border-[#4a4a4a]/20 hover:border-[#d96459]/50 hover:bg-[#ede8dd] dark:hover:bg-accent">
                <Link to="/admin/settings">Site Settings</Link>
              </Button>
              <Button asChild variant="outline" className="border-[#4a4a4a]/20 hover:border-[#d96459]/50 hover:bg-[#ede8dd] dark:hover:bg-accent">
                <Link to="/domains">Domains</Link>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Onboarding Modal */}
      <OnboardingModal isOpen={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </div>
  );
}
