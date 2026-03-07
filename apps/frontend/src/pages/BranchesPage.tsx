import { useParams } from 'react-router-dom';
import { BranchesTab } from '@/components/repo/BranchesTab';

/**
 * BranchesPage - Wrapper for BranchesTab that extracts URL params.
 * Route: /repo/:owner/:repo/branches
 */
export function BranchesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  return <BranchesTab owner={owner!} repo={repo!} />;
}
