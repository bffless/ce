import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { FileBrowserSidebar } from './FileBrowserSidebar';
import type { FileMetadata } from '@/lib/file-tree';
import uiReducer from '@/store/slices/uiSlice';

// Mock data
const mockFiles: FileMetadata[] = [
  {
    path: 'README.md',
    fileName: 'README.md',
    size: 1024,
    mimeType: 'text/markdown',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'src/index.ts',
    fileName: 'index.ts',
    size: 2048,
    mimeType: 'text/typescript',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'src/components/Button.tsx',
    fileName: 'Button.tsx',
    size: 3072,
    mimeType: 'text/typescript',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'src/utils/helpers.ts',
    fileName: 'helpers.ts',
    size: 1536,
    mimeType: 'text/typescript',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'package.json',
    fileName: 'package.json',
    size: 512,
    mimeType: 'application/json',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
];

// Helper function to create a test store
function createTestStore(initialState: Partial<{ fileBrowser: { searchQuery: string; expandedPaths: string[] } }> = {}) {
  return configureStore({
    reducer: {
      ui: uiReducer,
    },
    preloadedState: {
      ui: {
        sidebarOpen: true,
        sidebarWidth: 300,
        activeTab: 'code' as const,
        fileBrowser: {
          searchQuery: '',
          expandedPaths: [],
        },
        ...initialState,
      },
    },
  });
}

// Helper function to render component with providers
function renderWithProviders(
  ui: React.ReactElement,
  {
    initialState = {},
    store = createTestStore(initialState),
    route = '/repo/owner/repo/main',
  } = {},
) {
  return {
    ...render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={[route]}
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          {ui}
        </MemoryRouter>
      </Provider>,
    ),
    store,
  };
}

describe('FileBrowserSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should render loading skeletons when isLoading is true', () => {
      const { container } = renderWithProviders(<FileBrowserSidebar files={[]} isLoading={true} />);

      // Should show skeleton for search input
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should not render file tree when loading', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} isLoading={true} />);

      expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should render error message when error prop is provided', () => {
      const errorMessage = 'Failed to load files';
      renderWithProviders(<FileBrowserSidebar files={[]} error={errorMessage} />);

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should show error alert with destructive variant', () => {
      renderWithProviders(<FileBrowserSidebar files={[]} error="Test error" />);

      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });

    it('should still render Files header in error state', () => {
      renderWithProviders(<FileBrowserSidebar files={[]} error="Test error" />);

      expect(screen.getByText('Files')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should render empty state when no files provided', () => {
      renderWithProviders(<FileBrowserSidebar files={[]} />);

      expect(screen.getByText('No files found in this deployment')).toBeInTheDocument();
    });

    it('should show folder icon in empty state', () => {
      const { container } = renderWithProviders(<FileBrowserSidebar files={[]} />);

      const folderIcon = container.querySelector('svg');
      expect(folderIcon).toBeInTheDocument();
    });
  });

  describe('File Tree Rendering', () => {
    it('should render file tree with provided files', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      expect(screen.getByRole('tree')).toBeInTheDocument();
    });

    it('should display file count in header', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      expect(screen.getByText('5 files')).toBeInTheDocument();
    });

    it('should display singular file count for one file', () => {
      renderWithProviders(<FileBrowserSidebar files={[mockFiles[0]]} />);

      expect(screen.getByText('1 file')).toBeInTheDocument();
    });

    it('should render root level files', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      expect(screen.getByText('README.md')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    it('should render directories', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      expect(screen.getByText('src')).toBeInTheDocument();
    });

    it('should apply custom className when provided', () => {
      const { container } = renderWithProviders(
        <FileBrowserSidebar files={mockFiles} className="custom-class" />,
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Search Functionality', () => {
    it('should render search input', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const searchInput = screen.getByPlaceholderText(/Search files/i);
      expect(searchInput).toBeInTheDocument();
    });

    it('should update search query on input change', async () => {
      const { store } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />);
      const user = userEvent.setup();

      const searchInput = screen.getByPlaceholderText(/Search files/i);
      await user.type(searchInput, 'Button');

      expect(store.getState().ui.fileBrowser.searchQuery).toBe('Button');
    });

    it('should filter files based on search query', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'Button',
          expandedPaths: [],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      expect(screen.getByText('Button.tsx')).toBeInTheDocument();
      expect(screen.queryByText('README.md')).not.toBeInTheDocument();
    });

    it('should show clear button when search query exists', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: [],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      const clearButton = screen.getByLabelText('Clear search');
      expect(clearButton).toBeInTheDocument();
    });

    it('should clear search query when clear button is clicked', async () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: [],
        },
      });

      const { store: testStore } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />, {
        store,
      });

      const clearButton = screen.getByLabelText('Clear search');
      fireEvent.click(clearButton);

      expect(testStore.getState().ui.fileBrowser.searchQuery).toBe('');
    });

    it('should show no results message when search has no matches', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'nonexistent',
          expandedPaths: [],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      expect(screen.getByText(/No files match "nonexistent"/i)).toBeInTheDocument();
    });
  });

  describe('Directory Expansion', () => {
    it('should toggle directory expansion on chevron click', async () => {
      const { store } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      // Click the chevron to toggle, not the directory name (which now navigates)
      const chevron = screen.getByLabelText('Expand folder');
      fireEvent.click(chevron);

      // Check that the path was added to expandedPaths
      const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
      expect(expandedPaths).toContain('src');
    });

    it('should toggle directory expansion using keyboard (Enter) on chevron', async () => {
      const { store } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const chevron = screen.getByLabelText('Expand folder');
      fireEvent.keyDown(chevron, { key: 'Enter' });

      // Check that the path was added to expandedPaths
      const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
      expect(expandedPaths.length).toBeGreaterThan(0);
    });

    it('should toggle directory expansion using keyboard (Space) on chevron', async () => {
      const { store } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const chevron = screen.getByLabelText('Expand folder');
      fireEvent.keyDown(chevron, { key: ' ' });

      // Check that the path was added to expandedPaths
      const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
      expect(expandedPaths.length).toBeGreaterThan(0);
    });

    it('should display children when directory is expanded', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: '',
          expandedPaths: ['src'],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      expect(screen.getByText('index.ts')).toBeInTheDocument();
      expect(screen.getByText('components')).toBeInTheDocument();
      expect(screen.getByText('utils')).toBeInTheDocument();
    });

    it('should expand all parent directories when searching', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'Button',
          expandedPaths: [],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      // After rendering with search, src and src/components should be expanded
      waitFor(() => {
        const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
        expect(expandedPaths).toContain('src');
        expect(expandedPaths).toContain('src/components');
      });
    });
  });

  describe('File Selection', () => {
    it('should highlight active file', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} currentFilePath="README.md" />);

      const readmeNode = screen.getByText('README.md').closest('button');
      expect(readmeNode).toHaveClass('bg-accent');
    });

    it('should auto-expand parent directories of current file', async () => {
      const { store } = renderWithProviders(
        <FileBrowserSidebar files={mockFiles} currentFilePath="src/components/Button.tsx" />,
      );

      await waitFor(() => {
        const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
        expect(expandedPaths).toContain('src');
        expect(expandedPaths).toContain('src/components');
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should focus search input when / key is pressed', async () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const searchInput = screen.getByPlaceholderText(/Search files/i);

      // Simulate pressing '/'
      fireEvent.keyDown(document, { key: '/' });

      expect(searchInput).toHaveFocus();
    });

    it('should not focus search when / is pressed in an input', async () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const searchInput = screen.getByPlaceholderText(/Search files/i);
      searchInput.focus();

      // Simulate pressing '/' while focused on the input
      fireEvent.keyDown(searchInput, { key: '/' });

      // Should remain focused
      expect(searchInput).toHaveFocus();
    });

    it('should clear search when Escape is pressed in search input', async () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: [],
        },
      });

      const { store: testStore } = renderWithProviders(<FileBrowserSidebar files={mockFiles} />, {
        store,
      });

      const searchInput = screen.getByPlaceholderText(/Search files/i);
      searchInput.focus();

      fireEvent.keyDown(searchInput, { key: 'Escape' });

      expect(testStore.getState().ui.fileBrowser.searchQuery).toBe('');
    });
  });

  describe('Collapse Button', () => {
    it('should render collapse button when onCollapse is provided', () => {
      const onCollapse = vi.fn();
      renderWithProviders(<FileBrowserSidebar files={mockFiles} onCollapse={onCollapse} />);

      const collapseButton = screen.getByTitle('Collapse file tree');
      expect(collapseButton).toBeInTheDocument();
    });

    it('should not render collapse button when onCollapse is not provided', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      expect(screen.queryByTitle('Collapse file tree')).not.toBeInTheDocument();
    });

    it('should call onCollapse when collapse button is clicked', () => {
      const onCollapse = vi.fn();
      renderWithProviders(<FileBrowserSidebar files={mockFiles} onCollapse={onCollapse} />);

      const collapseButton = screen.getByTitle('Collapse file tree');
      fireEvent.click(collapseButton);

      expect(onCollapse).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on tree', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} />);

      const tree = screen.getByRole('tree');
      expect(tree).toHaveAttribute('aria-label', 'File tree');
    });

    it('should have proper ARIA attributes on tree items', () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: '',
          expandedPaths: ['src'],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={mockFiles} />, { store });

      const srcDirectory = screen.getByText('src').closest('button');
      expect(srcDirectory).toHaveAttribute('role', 'treeitem');
      expect(srcDirectory).toHaveAttribute('aria-expanded', 'true');
    });

    it('should mark active file with aria-selected', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} currentFilePath="README.md" />);

      const readmeNode = screen.getByText('README.md').closest('button');
      expect(readmeNode).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined files gracefully', () => {
      renderWithProviders(<FileBrowserSidebar />);

      expect(screen.getByText('No files found in this deployment')).toBeInTheDocument();
    });

    it('should handle null error gracefully', () => {
      renderWithProviders(<FileBrowserSidebar files={mockFiles} error={null} />);

      expect(screen.getByRole('tree')).toBeInTheDocument();
    });

    it('should not auto-expand when searching is active', async () => {
      const store = createTestStore({
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: [],
        },
      });

      renderWithProviders(
        <FileBrowserSidebar files={mockFiles} currentFilePath="src/components/Button.tsx" />,
        { store },
      );

      // Should not auto-expand parent directories when search is active
      // The search expansion logic should take precedence
      const expandedPaths = store.getState().ui.fileBrowser.expandedPaths;
      expect(expandedPaths).toEqual([]);
    });

    it('should handle files with special characters in names', () => {
      const specialFiles: FileMetadata[] = [
        {
          path: 'file-with-dashes.ts',
          fileName: 'file-with-dashes.ts',
          size: 100,
          mimeType: 'text/typescript',
          isPublic: true,
          createdAt: '2024-01-15T10:30:00Z',
        },
        {
          path: 'file_with_underscores.ts',
          fileName: 'file_with_underscores.ts',
          size: 100,
          mimeType: 'text/typescript',
          isPublic: true,
          createdAt: '2024-01-15T10:30:00Z',
        },
      ];

      renderWithProviders(<FileBrowserSidebar files={specialFiles} />);

      expect(screen.getByText('file-with-dashes.ts')).toBeInTheDocument();
      expect(screen.getByText('file_with_underscores.ts')).toBeInTheDocument();
    });

    it('should handle deeply nested directories', () => {
      const deepFiles: FileMetadata[] = [
        {
          path: 'a/b/c/d/e/deep.ts',
          fileName: 'deep.ts',
          size: 100,
          mimeType: 'text/typescript',
          isPublic: true,
          createdAt: '2024-01-15T10:30:00Z',
        },
      ];

      const store = createTestStore({
        fileBrowser: {
          searchQuery: '',
          expandedPaths: ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e'],
        },
      });

      renderWithProviders(<FileBrowserSidebar files={deepFiles} />, { store });

      expect(screen.getByText('deep.ts')).toBeInTheDocument();
    });
  });
});
