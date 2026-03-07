import { useParams } from 'react-router-dom';
import { DeploymentsList } from '@/components/repo/DeploymentsList';

/**
 * DeploymentsTab - Wrapper for DeploymentsList that extracts URL params.
 * Route: /repo/:owner/:repo/deployments
 */
export function DeploymentsTab() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  return <DeploymentsList owner={owner!} repo={repo!} />;
}
