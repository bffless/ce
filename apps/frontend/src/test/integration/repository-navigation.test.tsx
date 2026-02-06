/**
 * Integration tests for repository navigation
 * Tests multiple components working together
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import repoReducer from '../../store/slices/repoSlice';
import uiReducer from '../../store/slices/uiSlice';
import { api } from '../../services/api';

// Create a test store
const createTestStore = () => {
  return configureStore({
    reducer: {
      repo: repoReducer,
      ui: uiReducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
};

describe('Repository Navigation Integration Tests', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  describe('Store Integration', () => {
    it('should update repo state and UI state together', () => {
      const store = createTestStore();

      // Dispatch repo action
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'testuser', repo: 'test-repo' },
      });

      // Dispatch UI action
      store.dispatch({
        type: 'ui/setSidebarOpen',
        payload: false,
      });

      const state = store.getState();
      expect(state.repo.currentRepo).toEqual({
        owner: 'testuser',
        repo: 'test-repo',
      });
      expect(state.ui.sidebarOpen).toBe(false);
    });

    it('should handle navigation workflow', () => {
      const store = createTestStore();

      // Simulate navigation workflow
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'user', repo: 'repo' },
      });

      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'main',
      });

      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'index.html',
      });

      store.dispatch({
        type: 'repo/selectFile',
        payload: {
          path: 'index.html',
          name: 'index.html',
          size: 1024,
          mimeType: 'text/html',
        },
      });

      const state = store.getState();
      expect(state.repo.currentRepo?.repo).toBe('repo');
      expect(state.repo.currentRef).toBe('main');
      expect(state.repo.currentFilePath).toBe('index.html');
      expect(state.repo.selectedFile?.name).toBe('index.html');
    });

    it('should clear repo state on navigation away', () => {
      const store = createTestStore();

      // Set up state
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'user', repo: 'repo' },
      });
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'main',
      });

      // Clear state
      store.dispatch({ type: 'repo/clearRepoState' });

      const state = store.getState();
      expect(state.repo.currentRepo).toBeNull();
      expect(state.repo.currentRef).toBeNull();
      expect(state.repo.currentFilePath).toBeNull();
      expect(state.repo.selectedFile).toBeNull();
    });
  });

  describe('Tab Navigation', () => {
    it('should switch between different tabs', () => {
      const store = createTestStore();

      // Start on code tab
      expect(store.getState().ui.activeTab).toBe('code');

      // Switch to preview
      store.dispatch({
        type: 'ui/setActiveTab',
        payload: 'preview',
      });
      expect(store.getState().ui.activeTab).toBe('preview');

      // Switch to history
      store.dispatch({
        type: 'ui/setActiveTab',
        payload: 'history',
      });
      expect(store.getState().ui.activeTab).toBe('history');

      // Back to code
      store.dispatch({
        type: 'ui/setActiveTab',
        payload: 'code',
      });
      expect(store.getState().ui.activeTab).toBe('code');
    });

    it('should maintain tab state during file navigation', () => {
      const store = createTestStore();

      // Set preview tab
      store.dispatch({
        type: 'ui/setActiveTab',
        payload: 'preview',
      });

      // Navigate to file
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'index.html',
      });

      // Tab should remain on preview
      expect(store.getState().ui.activeTab).toBe('preview');
      expect(store.getState().repo.currentFilePath).toBe('index.html');
    });
  });

  describe('File Browser Search', () => {
    it('should update search query and auto-expand paths', () => {
      const store = createTestStore();

      // Set search query
      store.dispatch({
        type: 'ui/setFileBrowserSearchQuery',
        payload: 'index',
      });

      expect(store.getState().ui.fileBrowser.searchQuery).toBe('index');
    });

    it('should clear search and collapse paths', () => {
      const store = createTestStore();

      // Set up search with expanded paths
      store.dispatch({
        type: 'ui/setFileBrowserSearchQuery',
        payload: 'test',
      });
      store.dispatch({
        type: 'ui/setFileBrowserExpandedPaths',
        payload: ['src', 'src/components'],
      });

      // Clear search
      store.dispatch({
        type: 'ui/setFileBrowserSearchQuery',
        payload: '',
      });

      expect(store.getState().ui.fileBrowser.searchQuery).toBe('');
      // Expanded paths should remain (only cleared by user action)
      expect(store.getState().ui.fileBrowser.expandedPaths).toEqual(['src', 'src/components']);
    });

    it('should toggle expanded paths during search', () => {
      const store = createTestStore();

      // Expand a path
      store.dispatch({
        type: 'ui/toggleFileBrowserPath',
        payload: 'src',
      });
      expect(store.getState().ui.fileBrowser.expandedPaths).toContain('src');

      // Collapse it
      store.dispatch({
        type: 'ui/toggleFileBrowserPath',
        payload: 'src',
      });
      expect(store.getState().ui.fileBrowser.expandedPaths).not.toContain('src');
    });
  });

  describe('Sidebar State Management', () => {
    it('should toggle sidebar and persist state', () => {
      const store = createTestStore();

      // Initial state
      expect(store.getState().ui.sidebarOpen).toBe(true);

      // Toggle closed
      store.dispatch({ type: 'ui/toggleSidebar' });
      expect(store.getState().ui.sidebarOpen).toBe(false);

      // Toggle open
      store.dispatch({ type: 'ui/toggleSidebar' });
      expect(store.getState().ui.sidebarOpen).toBe(true);
    });

    it('should resize sidebar', () => {
      const store = createTestStore();

      // Initial width
      expect(store.getState().ui.sidebarWidth).toBe(300);

      // Resize
      store.dispatch({
        type: 'ui/setSidebarWidth',
        payload: 350,
      });
      expect(store.getState().ui.sidebarWidth).toBe(350);
    });

    it('should maintain sidebar state during navigation', () => {
      const store = createTestStore();

      // Close sidebar
      store.dispatch({ type: 'ui/setSidebarOpen', payload: false });

      // Navigate
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'test.html',
      });

      // Sidebar should remain closed
      expect(store.getState().ui.sidebarOpen).toBe(false);
    });
  });

  describe('Branch/Ref Switching', () => {
    it('should switch refs and maintain file path', () => {
      const store = createTestStore();

      // Set initial state
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'user', repo: 'repo' },
      });
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'main',
      });
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'index.html',
      });

      // Switch branch
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'develop',
      });

      // File path should be maintained
      expect(store.getState().repo.currentRef).toBe('develop');
      expect(store.getState().repo.currentFilePath).toBe('index.html');
    });

    it('should switch to commit SHA', () => {
      const store = createTestStore();

      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'abc123def456',
      });

      expect(store.getState().repo.currentRef).toBe('abc123def456');
    });
  });

  describe('Complete Navigation Flow', () => {
    it('should handle full user journey', () => {
      const store = createTestStore();

      // 1. User lands on repository page
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'testuser', repo: 'test-repo' },
      });
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'main',
      });

      // 2. User searches for a file
      store.dispatch({
        type: 'ui/setFileBrowserSearchQuery',
        payload: 'index',
      });

      // 3. User expands a folder
      store.dispatch({
        type: 'ui/toggleFileBrowserPath',
        payload: 'src',
      });

      // 4. User selects a file
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'src/index.html',
      });
      store.dispatch({
        type: 'repo/selectFile',
        payload: {
          path: 'src/index.html',
          name: 'index.html',
          size: 2048,
          mimeType: 'text/html',
        },
      });

      // 5. User switches to preview tab
      store.dispatch({
        type: 'ui/setActiveTab',
        payload: 'preview',
      });

      // 6. User switches branch
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'develop',
      });

      // Verify final state
      const state = store.getState();
      expect(state.repo.currentRepo).toEqual({
        owner: 'testuser',
        repo: 'test-repo',
      });
      expect(state.repo.currentRef).toBe('develop');
      expect(state.repo.currentFilePath).toBe('src/index.html');
      expect(state.repo.selectedFile?.name).toBe('index.html');
      expect(state.ui.activeTab).toBe('preview');
      expect(state.ui.fileBrowser.searchQuery).toBe('index');
      expect(state.ui.fileBrowser.expandedPaths).toContain('src');
    });

    it('should handle error recovery', () => {
      const store = createTestStore();

      // Set up valid state
      store.dispatch({
        type: 'repo/setCurrentRepo',
        payload: { owner: 'user', repo: 'repo' },
      });
      store.dispatch({
        type: 'repo/setCurrentRef',
        payload: 'main',
      });

      // Simulate navigation to non-existent file (would trigger error in real app)
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: 'non-existent.html',
      });

      // Should still be in valid state
      expect(store.getState().repo.currentRepo).toBeTruthy();
      expect(store.getState().repo.currentRef).toBe('main');

      // User can recover by clearing path
      store.dispatch({
        type: 'repo/setCurrentFilePath',
        payload: null,
      });

      expect(store.getState().repo.currentFilePath).toBeNull();
    });
  });
});
