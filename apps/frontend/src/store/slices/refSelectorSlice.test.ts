import { describe, it, expect, beforeEach, vi } from 'vitest';
import reducer, {
  setRefSelectorOpen,
  toggleRefSelector,
  setRefSearchQuery,
  clearRefSearchQuery,
  setActiveTab,
  type RefSelectorTab,
} from './refSelectorSlice';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('refSelectorSlice', () => {
  const initialState = {
    isOpen: false,
    searchQuery: '',
    activeTab: 'aliases' as RefSelectorTab,
  };

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('setRefSelectorOpen', () => {
    it('should set isOpen to true', () => {
      const state = reducer(initialState, setRefSelectorOpen(true));
      expect(state.isOpen).toBe(true);
    });

    it('should set isOpen to false', () => {
      const openState = { ...initialState, isOpen: true };
      const state = reducer(openState, setRefSelectorOpen(false));
      expect(state.isOpen).toBe(false);
    });

    it('should persist isOpen to localStorage', () => {
      reducer(initialState, setRefSelectorOpen(true));
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'refSelector.isOpen',
        'true'
      );
    });
  });

  describe('toggleRefSelector', () => {
    it('should toggle isOpen from false to true', () => {
      const state = reducer(initialState, toggleRefSelector());
      expect(state.isOpen).toBe(true);
    });

    it('should toggle isOpen from true to false', () => {
      const openState = { ...initialState, isOpen: true };
      const state = reducer(openState, toggleRefSelector());
      expect(state.isOpen).toBe(false);
    });

    it('should persist toggled state to localStorage', () => {
      reducer(initialState, toggleRefSelector());
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'refSelector.isOpen',
        'true'
      );
    });
  });

  describe('setRefSearchQuery', () => {
    it('should set search query', () => {
      const state = reducer(initialState, setRefSearchQuery('main'));
      expect(state.searchQuery).toBe('main');
    });

    it('should handle empty search query', () => {
      const withQuery = { ...initialState, searchQuery: 'test' };
      const state = reducer(withQuery, setRefSearchQuery(''));
      expect(state.searchQuery).toBe('');
    });

    it('should preserve other state when setting search query', () => {
      const modifiedState = {
        isOpen: true,
        searchQuery: '',
        activeTab: 'commits' as RefSelectorTab,
      };
      const state = reducer(modifiedState, setRefSearchQuery('feature'));
      expect(state.isOpen).toBe(true);
      expect(state.activeTab).toBe('commits');
      expect(state.searchQuery).toBe('feature');
    });
  });

  describe('clearRefSearchQuery', () => {
    it('should clear search query', () => {
      const withQuery = { ...initialState, searchQuery: 'test' };
      const state = reducer(withQuery, clearRefSearchQuery());
      expect(state.searchQuery).toBe('');
    });

    it('should be idempotent when search is already empty', () => {
      const state = reducer(initialState, clearRefSearchQuery());
      expect(state.searchQuery).toBe('');
    });
  });

  describe('setActiveTab', () => {
    it('should set active tab to branches', () => {
      const state = reducer(initialState, setActiveTab('branches'));
      expect(state.activeTab).toBe('branches');
    });

    it('should set active tab to commits', () => {
      const state = reducer(initialState, setActiveTab('commits'));
      expect(state.activeTab).toBe('commits');
    });

    it('should set active tab to aliases', () => {
      const withCommits = { ...initialState, activeTab: 'commits' as RefSelectorTab };
      const state = reducer(withCommits, setActiveTab('aliases'));
      expect(state.activeTab).toBe('aliases');
    });

    it('should persist active tab to localStorage', () => {
      reducer(initialState, setActiveTab('branches'));
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'refSelector.activeTab',
        'branches'
      );
    });
  });

  describe('state persistence', () => {
    it('should not persist search query', () => {
      reducer(initialState, setRefSearchQuery('test'));
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'refSelector.searchQuery',
        expect.anything()
      );
    });
  });

  describe('initial state', () => {
    it('should have correct default values', () => {
      expect(initialState.isOpen).toBe(false);
      expect(initialState.searchQuery).toBe('');
      expect(initialState.activeTab).toBe('aliases');
    });
  });
});
