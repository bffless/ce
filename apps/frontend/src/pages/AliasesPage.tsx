import { useParams } from 'react-router-dom';
import { AliasesTab } from '@/components/repo/AliasesTab';

/**
 * AliasesPage - Wrapper for AliasesTab that extracts URL params.
 * Route: /repo/:owner/:repo/aliases
 */
export function AliasesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  return <AliasesTab owner={owner!} repo={repo!} />;
}
