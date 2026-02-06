import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type TabType = 'code' | 'preview' | 'history';

export interface UiState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activeTab: TabType;
  fileBrowser: {
    searchQuery: string;
    expandedPaths: string[];
  };
}

// Load persisted UI state from localStorage
const loadPersistedState = (): Partial<UiState> => {
  try {
    const savedSidebarOpen = localStorage.getItem('ui.sidebarOpen');
    const savedSidebarWidth = localStorage.getItem('ui.sidebarWidth');

    return {
      sidebarOpen: savedSidebarOpen !== null ? JSON.parse(savedSidebarOpen) : true,
      sidebarWidth: savedSidebarWidth !== null ? JSON.parse(savedSidebarWidth) : 300,
    };
  } catch (error) {
    console.error('Failed to load persisted UI state:', error);
    return {};
  }
};

const persistedState = loadPersistedState();

const initialState: UiState = {
  sidebarOpen: persistedState.sidebarOpen ?? true,
  sidebarWidth: persistedState.sidebarWidth ?? 300,
  activeTab: 'code',
  fileBrowser: {
    searchQuery: '',
    expandedPaths: [],
  },
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
      // Persist to localStorage
      try {
        localStorage.setItem('ui.sidebarOpen', JSON.stringify(state.sidebarOpen));
      } catch (error) {
        console.error('Failed to persist sidebar state:', error);
      }
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
      // Persist to localStorage
      try {
        localStorage.setItem('ui.sidebarOpen', JSON.stringify(state.sidebarOpen));
      } catch (error) {
        console.error('Failed to persist sidebar state:', error);
      }
    },
    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = action.payload;
      // Persist to localStorage
      try {
        localStorage.setItem('ui.sidebarWidth', JSON.stringify(state.sidebarWidth));
      } catch (error) {
        console.error('Failed to persist sidebar width:', error);
      }
    },
    setActiveTab: (state, action: PayloadAction<TabType>) => {
      state.activeTab = action.payload;
    },
    // File browser actions
    setFileBrowserSearchQuery: (state, action: PayloadAction<string>) => {
      state.fileBrowser.searchQuery = action.payload;
    },
    setFileBrowserExpandedPaths: (state, action: PayloadAction<string[]>) => {
      state.fileBrowser.expandedPaths = action.payload;
    },
    toggleFileBrowserPath: (state, action: PayloadAction<string>) => {
      const path = action.payload;
      const index = state.fileBrowser.expandedPaths.indexOf(path);
      if (index >= 0) {
        state.fileBrowser.expandedPaths.splice(index, 1);
      } else {
        state.fileBrowser.expandedPaths.push(path);
      }
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setSidebarWidth,
  setActiveTab,
  setFileBrowserSearchQuery,
  setFileBrowserExpandedPaths,
  toggleFileBrowserPath,
} = uiSlice.actions;

export default uiSlice.reducer;
