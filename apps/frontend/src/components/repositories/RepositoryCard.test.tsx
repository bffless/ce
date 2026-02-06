import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { RepositoryCard } from './RepositoryCard';
import type { FeedRepository } from '@/services/repositoriesApi';

// Mock the TooltipProvider to avoid React hook issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Wrapper for components that use React Router
const RouterWrapper = ({ children }: { children: React.ReactNode }) => {
  return <BrowserRouter>{children}</BrowserRouter>;
};

// Mock repository data
const mockRepository: FeedRepository = {
  id: 'repo-1',
  owner: 'testuser',
  name: 'test-repo',
  displayName: 'Test Repository',
  description: 'A test repository for unit tests',
  isPublic: true,
  permissionType: 'owner',
  role: 'owner',
  stats: {
    deploymentCount: 10,
    storageBytes: 1048576, // 1 MB
    storageMB: 1.0,
    lastDeployedAt: '2025-01-15T10:00:00Z',
  },
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z',
};

const mockPrivateRepository: FeedRepository = {
  ...mockRepository,
  id: 'repo-2',
  name: 'private-repo',
  displayName: 'Private Repository',
  isPublic: false,
  permissionType: 'direct',
  role: 'admin',
};

const mockPublicRepository: FeedRepository = {
  ...mockRepository,
  id: 'repo-3',
  name: 'public-repo',
  displayName: null,
  description: null,
  isPublic: true,
  permissionType: 'public',
  role: null,
  stats: {
    deploymentCount: 0,
    storageBytes: 0,
    storageMB: 0,
    lastDeployedAt: null,
  },
};

describe('RepositoryCard', () => {
  it('renders repository name as link', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    const link = screen.getByRole('link', { name: /testuser\/test-repo/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/repo/testuser/test-repo');
  });

  it('displays repository display name when available', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('Test Repository')).toBeInTheDocument();
  });

  it('displays repository description when available', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('A test repository for unit tests')).toBeInTheDocument();
  });

  it('does not display description when null', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPublicRepository} />
      </RouterWrapper>
    );

    // Description should not be in document
    const card = screen.getByRole('article');
    expect(card.textContent).not.toContain('A test repository');
  });

  it('displays deployment count', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText(/10 deployments/i)).toBeInTheDocument();
  });

  it('displays singular "deployment" for count of 1', () => {
    const singleDeploymentRepo: FeedRepository = {
      ...mockRepository,
      stats: { ...mockRepository.stats, deploymentCount: 1 },
    };

    render(
      <RouterWrapper>
        <RepositoryCard repository={singleDeploymentRepo} />
      </RouterWrapper>
    );

    expect(screen.getByText(/1 deployment$/i)).toBeInTheDocument();
  });

  it('displays storage in MB', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText(/1\.0 MB/i)).toBeInTheDocument();
  });

  it('displays "Updated" time when lastDeployedAt is available', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText(/Updated/i)).toBeInTheDocument();
  });

  it('does not display updated time when lastDeployedAt is null', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPublicRepository} />
      </RouterWrapper>
    );

    expect(screen.queryByText(/Updated/i)).not.toBeInTheDocument();
  });

  it('displays permission badge for owner', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('displays permission badge for admin', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPrivateRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('does not display permission badge for public repos', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPublicRepository} />
      </RouterWrapper>
    );

    // Permission badge should not be shown for public repos
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Contributor')).not.toBeInTheDocument();
    expect(screen.queryByText('Viewer')).not.toBeInTheDocument();
  });

  it('displays Public visibility badge', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('displays Private visibility badge', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPrivateRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('displays "View Repository" button', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    const buttons = screen.getAllByRole('link', { name: /View Repository/i });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]).toHaveAttribute('href', '/repo/testuser/test-repo');
  });

  it('has article role for accessibility', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', 'Repository: testuser/test-repo');
  });

  it('displays activity badge for recently updated repos', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    // Activity badge should be present (Active/Inactive/Idle)
    const article = screen.getByRole('article');
    expect(article.textContent).toMatch(/Active|Inactive|Idle/i);
  });

  it('handles repository with no deployments', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockPublicRepository} />
      </RouterWrapper>
    );

    expect(screen.getByText(/0 deployments/i)).toBeInTheDocument();
    expect(screen.getByText(/0 MB/i)).toBeInTheDocument();
  });

  it('applies hover effect class', () => {
    const { container } = render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    const card = container.querySelector('.hover\\:shadow-md');
    expect(card).toBeInTheDocument();
  });

  it('renders as a card with proper structure', () => {
    render(
      <RouterWrapper>
        <RepositoryCard repository={mockRepository} />
      </RouterWrapper>
    );

    // Should have CardHeader, CardContent, and CardFooter
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();

    // Check for owner/name in header
    expect(screen.getByText(/testuser\/test-repo/i)).toBeInTheDocument();

    // Check for stats in content
    expect(screen.getByText(/deployments/i)).toBeInTheDocument();

    // Check for button in footer
    const buttons = screen.getAllByRole('link', { name: /View Repository/i });
    expect(buttons.length).toBeGreaterThan(0);
  });
});
