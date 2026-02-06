import { describe, it, expect, beforeEach, vi } from 'vitest';
import uiReducer, {
  toggleSidebar,
  setSidebarOpen,
  setSidebarWidth,
  setActiveTab,
  setFileBrowserSearchQuery,
  setFileBrowserExpandedPaths,
  toggleFileBrowserPath,
  UiState,
} from './uiSlice';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

describe('uiSlice', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Suppress console.error for localStorage tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const initialState: UiState = {
    sidebarOpen: true,
    sidebarWidth: 300,
    activeTab: 'code',
    fileBrowser: {
      searchQuery: '',
      expandedPaths: [],
    },
  };

  describe('toggleSidebar', () => {
    it('should toggle sidebar from open to closed', () => {
      const action = toggleSidebar();
      const state = uiReducer(initialState, action);

      expect(state.sidebarOpen).toBe(false);
    });

    it('should toggle sidebar from closed to open', () => {
      const closedState: UiState = {
        ...initialState,
        sidebarOpen: false,
      };

      const action = toggleSidebar();
      const state = uiReducer(closedState, action);

      expect(state.sidebarOpen).toBe(true);
    });

    it('should persist sidebar state to localStorage', () => {
      const action = toggleSidebar();
      uiReducer(initialState, action);

      expect(localStorage.getItem('ui.sidebarOpen')).toBe('false');
    });

    it('should handle multiple toggles', () => {
      let state = initialState;

      state = uiReducer(state, toggleSidebar());
      expect(state.sidebarOpen).toBe(false);

      state = uiReducer(state, toggleSidebar());
      expect(state.sidebarOpen).toBe(true);

      state = uiReducer(state, toggleSidebar());
      expect(state.sidebarOpen).toBe(false);
    });
  });

  describe('setSidebarOpen', () => {
    it('should set sidebar to open', () => {
      const closedState: UiState = {
        ...initialState,
        sidebarOpen: false,
      };

      const action = setSidebarOpen(true);
      const state = uiReducer(closedState, action);

      expect(state.sidebarOpen).toBe(true);
    });

    it('should set sidebar to closed', () => {
      const action = setSidebarOpen(false);
      const state = uiReducer(initialState, action);

      expect(state.sidebarOpen).toBe(false);
    });

    it('should persist sidebar open state to localStorage', () => {
      const action = setSidebarOpen(true);
      uiReducer(initialState, action);

      expect(localStorage.getItem('ui.sidebarOpen')).toBe('true');
    });

    it('should persist sidebar closed state to localStorage', () => {
      const action = setSidebarOpen(false);
      uiReducer(initialState, action);

      expect(localStorage.getItem('ui.sidebarOpen')).toBe('false');
    });
  });

  describe('setSidebarWidth', () => {
    it('should set sidebar width', () => {
      const action = setSidebarWidth(350);
      const state = uiReducer(initialState, action);

      expect(state.sidebarWidth).toBe(350);
    });

    it('should handle minimum width', () => {
      const action = setSidebarWidth(200);
      const state = uiReducer(initialState, action);

      expect(state.sidebarWidth).toBe(200);
    });

    it('should handle maximum width', () => {
      const action = setSidebarWidth(400);
      const state = uiReducer(initialState, action);

      expect(state.sidebarWidth).toBe(400);
    });

    it('should persist sidebar width to localStorage', () => {
      const action = setSidebarWidth(350);
      uiReducer(initialState, action);

      expect(localStorage.getItem('ui.sidebarWidth')).toBe('350');
    });
  });

  describe('setActiveTab', () => {
    it('should set active tab to code', () => {
      const action = setActiveTab('code');
      const state = uiReducer(initialState, action);

      expect(state.activeTab).toBe('code');
    });

    it('should set active tab to preview', () => {
      const action = setActiveTab('preview');
      const state = uiReducer(initialState, action);

      expect(state.activeTab).toBe('preview');
    });

    it('should set active tab to history', () => {
      const action = setActiveTab('history');
      const state = uiReducer(initialState, action);

      expect(state.activeTab).toBe('history');
    });

    it('should change tab from preview to code', () => {
      const previewState: UiState = {
        ...initialState,
        activeTab: 'preview',
      };

      const action = setActiveTab('code');
      const state = uiReducer(previewState, action);

      expect(state.activeTab).toBe('code');
    });
  });

  describe('setFileBrowserSearchQuery', () => {
    it('should set search query', () => {
      const action = setFileBrowserSearchQuery('index');
      const state = uiReducer(initialState, action);

      expect(state.fileBrowser.searchQuery).toBe('index');
    });

    it('should clear search query', () => {
      const searchState: UiState = {
        ...initialState,
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: [],
        },
      };

      const action = setFileBrowserSearchQuery('');
      const state = uiReducer(searchState, action);

      expect(state.fileBrowser.searchQuery).toBe('');
    });

    it('should handle special characters', () => {
      const action = setFileBrowserSearchQuery('test-file_v2.js');
      const state = uiReducer(initialState, action);

      expect(state.fileBrowser.searchQuery).toBe('test-file_v2.js');
    });
  });

  describe('setFileBrowserExpandedPaths', () => {
    it('should set expanded paths', () => {
      const paths = ['src', 'src/components', 'src/lib'];
      const action = setFileBrowserExpandedPaths(paths);
      const state = uiReducer(initialState, action);

      expect(state.fileBrowser.expandedPaths).toEqual(paths);
    });

    it('should replace existing expanded paths', () => {
      const existingState: UiState = {
        ...initialState,
        fileBrowser: {
          searchQuery: '',
          expandedPaths: ['old', 'paths'],
        },
      };

      const newPaths = ['new', 'paths', 'here'];
      const action = setFileBrowserExpandedPaths(newPaths);
      const state = uiReducer(existingState, action);

      expect(state.fileBrowser.expandedPaths).toEqual(newPaths);
    });

    it('should handle empty array', () => {
      const action = setFileBrowserExpandedPaths([]);
      const state = uiReducer(initialState, action);

      expect(state.fileBrowser.expandedPaths).toEqual([]);
    });
  });

  describe('toggleFileBrowserPath', () => {
    it('should add path when not present', () => {
      const action = toggleFileBrowserPath('src');
      const state = uiReducer(initialState, action);

      expect(state.fileBrowser.expandedPaths).toContain('src');
    });

    it('should remove path when present', () => {
      const existingState: UiState = {
        ...initialState,
        fileBrowser: {
          searchQuery: '',
          expandedPaths: ['src', 'lib'],
        },
      };

      const action = toggleFileBrowserPath('src');
      const state = uiReducer(existingState, action);

      expect(state.fileBrowser.expandedPaths).not.toContain('src');
      expect(state.fileBrowser.expandedPaths).toContain('lib');
    });

    it('should handle multiple toggles', () => {
      let state = initialState;

      // Add 'src'
      state = uiReducer(state, toggleFileBrowserPath('src'));
      expect(state.fileBrowser.expandedPaths).toEqual(['src']);

      // Add 'lib'
      state = uiReducer(state, toggleFileBrowserPath('lib'));
      expect(state.fileBrowser.expandedPaths).toEqual(['src', 'lib']);

      // Remove 'src'
      state = uiReducer(state, toggleFileBrowserPath('src'));
      expect(state.fileBrowser.expandedPaths).toEqual(['lib']);

      // Add 'src' back
      state = uiReducer(state, toggleFileBrowserPath('src'));
      expect(state.fileBrowser.expandedPaths).toEqual(['lib', 'src']);
    });

    it('should handle nested paths', () => {
      let state = initialState;

      state = uiReducer(state, toggleFileBrowserPath('src'));
      state = uiReducer(state, toggleFileBrowserPath('src/components'));
      state = uiReducer(state, toggleFileBrowserPath('src/components/repo'));

      expect(state.fileBrowser.expandedPaths).toEqual([
        'src',
        'src/components',
        'src/components/repo',
      ]);
    });
  });

  describe('state immutability', () => {
    it('should not mutate original state', () => {
      const originalState: UiState = {
        sidebarOpen: true,
        sidebarWidth: 300,
        activeTab: 'code',
        fileBrowser: {
          searchQuery: 'test',
          expandedPaths: ['src', 'lib'],
        },
      };

      // Create a deep copy
      const stateCopy = JSON.parse(JSON.stringify(originalState));

      // Perform action
      uiReducer(originalState, toggleSidebar());

      // Original state should be unchanged
      expect(originalState).toEqual(stateCopy);
    });

    it('should not mutate expandedPaths array', () => {
      const paths = ['src', 'lib'];
      const state: UiState = {
        ...initialState,
        fileBrowser: {
          searchQuery: '',
          expandedPaths: paths,
        },
      };

      uiReducer(state, toggleFileBrowserPath('new-path'));

      // Original array should be unchanged
      expect(paths).toEqual(['src', 'lib']);
    });
  });

  describe('action chaining', () => {
    it('should handle multiple UI actions in sequence', () => {
      let state = initialState;

      state = uiReducer(state, setSidebarOpen(false));
      expect(state.sidebarOpen).toBe(false);

      state = uiReducer(state, setSidebarWidth(350));
      expect(state.sidebarWidth).toBe(350);

      state = uiReducer(state, setActiveTab('preview'));
      expect(state.activeTab).toBe('preview');

      state = uiReducer(state, setFileBrowserSearchQuery('test'));
      expect(state.fileBrowser.searchQuery).toBe('test');

      state = uiReducer(state, toggleFileBrowserPath('src'));
      expect(state.fileBrowser.expandedPaths).toContain('src');

      // All previous state should be preserved
      expect(state.sidebarOpen).toBe(false);
      expect(state.sidebarWidth).toBe(350);
      expect(state.activeTab).toBe('preview');
      expect(state.fileBrowser.searchQuery).toBe('test');
    });
  });

  describe('localStorage persistence', () => {
    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw error
      expect(() => {
        uiReducer(initialState, toggleSidebar());
      }).not.toThrow();

      // Restore original
      localStorage.setItem = originalSetItem;
    });
  });
});
