import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * RepositoryTabRedirect - Handles backward compatibility for old query param URLs.
 * Redirects ?tab=X to the new path-based routes.
 */
export function RepositoryTabRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');

  // Map old tab query params to new paths
  switch (tab) {
    case 'branches':
      return <Navigate to="branches" replace />;
    case 'aliases':
      return <Navigate to="aliases" replace />;
    case 'proxy-rules':
      return <Navigate to="proxy-rules" replace />;
    case 'deployments':
    default:
      return <Navigate to="deployments" replace />;
  }
}
