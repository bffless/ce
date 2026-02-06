import { Navigate, useLocation } from 'react-router-dom';
import { useGetSessionQuery } from '@/services/authApi';
import { Skeleton } from '@/components/ui/skeleton';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

/**
 * ProtectedRoute - Wraps routes that require authentication
 *
 * Shows a loading state while checking session, then either:
 * - Renders children if authenticated (and admin if required)
 * - Redirects to login if not authenticated
 * - Redirects to home if authenticated but not admin (when requireAdmin=true)
 */
export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const location = useLocation();
  const { data: sessionData, isLoading } = useGetSessionQuery();

  const isAuthenticated = Boolean(sessionData?.user);
  const isAdmin = sessionData?.user?.role === 'admin';

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#ede8dd] dark:bg-background">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    const redirectPath = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirectPath}`} replace />;
  }

  // Redirect to verify-email if verification is required but not completed
  const emailVerified = sessionData?.emailVerified ?? true;
  const verificationRequired = sessionData?.emailVerificationRequired ?? false;
  if (verificationRequired && !emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  // Redirect to home if admin is required but user is not admin
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  // User is authenticated (and admin if required), render children
  return <>{children}</>;
}
