import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManagedFromGitBadge } from './ManagedFromGitBadge';
import type { ProxyRuleSetSource } from '@/services/proxyRulesApi';

const fullSource: ProxyRuleSetSource = {
  repo: 'bffless/apps',
  path: 'apps/studio/proxy-rules',
  gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  syncedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  contentHash: 'sha256:deadbeef',
};

describe('ManagedFromGitBadge', () => {
  it('renders label, repo@shortSha, and relative synced time for a full source', () => {
    render(<ManagedFromGitBadge source={fullSource} />);

    expect(screen.getByText('Managed from git')).toBeInTheDocument();
    // First 7 chars of the gitSha
    expect(screen.getByText('bffless/apps@a1b2c3d')).toBeInTheDocument();
    expect(screen.getByText('synced 2 hours ago')).toBeInTheDocument();
  });

  it('renders nothing without a source', () => {
    const { container: withNull } = render(<ManagedFromGitBadge source={null} />);
    expect(withNull).toBeEmptyDOMElement();

    const { container: withUndefined } = render(<ManagedFromGitBadge />);
    expect(withUndefined).toBeEmptyDOMElement();
  });

  it('degrades gracefully when source has only syncedAt/contentHash', () => {
    render(
      <ManagedFromGitBadge
        source={{
          syncedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          contentHash: 'sha256:cafef00d',
        }}
      />,
    );

    expect(screen.getByText('Managed from git')).toBeInTheDocument();
    expect(screen.getByText('synced 3 days ago')).toBeInTheDocument();
    // No origin fragment at all
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('shows repo alone when gitSha is absent', () => {
    render(
      <ManagedFromGitBadge
        source={{
          repo: 'bffless/apps',
          syncedAt: new Date().toISOString(),
          contentHash: 'sha256:cafef00d',
        }}
      />,
    );

    expect(screen.getByText('bffless/apps')).toBeInTheDocument();
  });

  it('shows @shortSha alone when repo is absent', () => {
    render(
      <ManagedFromGitBadge
        source={{
          gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          syncedAt: new Date().toISOString(),
          contentHash: 'sha256:cafef00d',
        }}
      />,
    );

    expect(screen.getByText('@a1b2c3d')).toBeInTheDocument();
  });
});
