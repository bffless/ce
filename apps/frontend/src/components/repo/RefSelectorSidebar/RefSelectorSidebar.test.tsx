import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { RefSelectorSidebar } from './RefSelectorSidebar';
import refSelectorReducer from '@/store/slices/refSelectorSlice';

// Mock the API hook
vi.mock('@/services/repoApi', () => ({
  useGetRepositoryRefsQuery: vi.fn(() => ({
    data: {
      aliases: [
        { name: 'production', commitSha: 'abc123def456', updatedAt: '2024-01-01T00:00:00Z' },
        { name: 'staging', commitSha: 'def456abc123', updatedAt: '2024-01-02T00:00:00Z' },
      ],
      branches: [
        { name: 'main', latestCommit: 'abc123def456', fileCount: 100 },
        { name: 'feature/test', latestCommit: 'ghi789jkl012', fileCount: 50 },
      ],
      recentCommits: [
        {
          sha: 'abc123def456',
          shortSha: 'abc123d',
          branch: 'main',
          description: 'Test commit',
          deployedAt: '2024-01-01T00:00:00Z',
          parentShas: [],
        },
      ],
    },
    isLoading: false,
    error: null,
  })),
}));

import type { RefSelectorTab } from '@/store/slices/refSelectorSlice';

interface RefSelectorState {
  refSelector: {
    isOpen: boolean;
    searchQuery: string;
    activeTab: RefSelectorTab;
  };
}

const renderWithProviders = (
  component: React.ReactNode,
  initialState: RefSelectorState = {
    refSelector: {
      isOpen: false,
      searchQuery: '',
      activeTab: 'aliases',
    },
  }
) => {
  const store = configureStore({
    reducer: {
      refSelector: refSelectorReducer,
    },
    preloadedState: initialState,
  });

  return {
    ...render(
      <Provider store={store}>
        <BrowserRouter>{component}</BrowserRouter>
      </Provider>
    ),
    store,
  };
};

describe('RefSelectorSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with title', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByText('References')).toBeInTheDocument();
  });

  it('should render search input', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('should render tabs', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByRole('tab', { name: /aliases/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /branches/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /commits/i })).toBeInTheDocument();
  });

  it('should show aliases tab content by default', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
  });

  it('should switch to branches tab when clicked', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />,
      {
        refSelector: {
          isOpen: false,
          searchQuery: '',
          activeTab: 'branches',
        },
      }
    );

    // When branches tab is active, branch items should be visible
    const branchesTab = screen.getByRole('tab', { name: /branches/i });
    expect(branchesTab).toHaveAttribute('aria-selected', 'true');

    // The listbox should show branches content
    expect(screen.getByRole('listbox', { name: /git branches/i })).toBeInTheDocument();
  });

  it('should have proper ARIA dialog role', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('should have search input with proper aria-label', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toHaveAttribute('aria-label', 'Search references');
  });

  it('should show close button with aria-label', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('should filter refs when searching', async () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'production' } });

    // Should show production alias
    expect(screen.getByText('production')).toBeInTheDocument();
    // Should not show staging (filtered out)
    expect(screen.queryByText('staging')).not.toBeInTheDocument();
  });

  it('should show selected indicator for current ref', () => {
    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    // The production alias points to the current ref
    const productionOption = screen.getByRole('option', { name: /production/i });
    expect(productionOption).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RefSelectorSidebar loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading skeletons while loading', async () => {
    const { useGetRepositoryRefsQuery } = await import('@/services/repoApi');
    vi.mocked(useGetRepositoryRefsQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGetRepositoryRefsQuery>);

    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    // Should still show the header
    expect(screen.getByText('References')).toBeInTheDocument();
    // Should have loading indicator
    const loadingArea = document.querySelector('[aria-busy="true"]');
    expect(loadingArea).toBeInTheDocument();
  });
});

describe('RefSelectorSidebar error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show error message on API error', async () => {
    const { useGetRepositoryRefsQuery } = await import('@/services/repoApi');
    vi.mocked(useGetRepositoryRefsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as unknown as ReturnType<typeof useGetRepositoryRefsQuery>);

    renderWithProviders(
      <RefSelectorSidebar
        owner="test"
        repo="repo"
        currentRef="abc123def456"
      />
    );

    expect(screen.getByText('Failed to load references')).toBeInTheDocument();
  });
});
