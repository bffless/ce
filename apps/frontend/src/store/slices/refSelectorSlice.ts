import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** Tab types for the ref selector sidebar */
export type RefSelectorTab = 'aliases' | 'branches' | 'commits';

interface RefSelectorState {
  /** Whether the ref selector sidebar is open */
  isOpen: boolean;
  /** Search query for filtering refs */
  searchQuery: string;
  /** Currently active tab */
  activeTab: RefSelectorTab;
}

// Load persisted state from localStorage
const loadPersistedState = (): Partial<RefSelectorState> => {
  try {
    const savedIsOpen = localStorage.getItem('refSelector.isOpen');
    const savedActiveTab = localStorage.getItem('refSelector.activeTab');

    // Validate the saved tab value
    let activeTab: RefSelectorTab | undefined;
    if (savedActiveTab === 'aliases' || savedActiveTab === 'branches' || savedActiveTab === 'commits') {
      activeTab = savedActiveTab;
    }

    return {
      isOpen: savedIsOpen !== null ? JSON.parse(savedIsOpen) : false,
      activeTab,
    };
  } catch (error) {
    console.error('Failed to load persisted ref selector state:', error);
    return {};
  }
};

const persistedState = loadPersistedState();

const initialState: RefSelectorState = {
  isOpen: persistedState.isOpen ?? false,
  searchQuery: '',
  activeTab: persistedState.activeTab ?? 'aliases',
};

export const refSelectorSlice = createSlice({
  name: 'refSelector',
  initialState,
  reducers: {
    /** Set the ref selector sidebar open state */
    setRefSelectorOpen: (state, action: PayloadAction<boolean>) => {
      state.isOpen = action.payload;
      // Persist to localStorage
      try {
        localStorage.setItem('refSelector.isOpen', JSON.stringify(state.isOpen));
      } catch (error) {
        console.error('Failed to persist ref selector state:', error);
      }
    },

    /** Toggle the ref selector sidebar */
    toggleRefSelector: (state) => {
      state.isOpen = !state.isOpen;
      // Persist to localStorage
      try {
        localStorage.setItem('refSelector.isOpen', JSON.stringify(state.isOpen));
      } catch (error) {
        console.error('Failed to persist ref selector state:', error);
      }
    },

    /** Set the search query */
    setRefSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },

    /** Reset search query (e.g., on close) */
    clearRefSearchQuery: (state) => {
      state.searchQuery = '';
    },

    /** Set the active tab */
    setActiveTab: (state, action: PayloadAction<RefSelectorTab>) => {
      state.activeTab = action.payload;
      // Persist to localStorage
      try {
        localStorage.setItem('refSelector.activeTab', action.payload);
      } catch (error) {
        console.error('Failed to persist ref selector tab:', error);
      }
    },
  },
});

export const {
  setRefSelectorOpen,
  toggleRefSelector,
  setRefSearchQuery,
  clearRefSearchQuery,
  setActiveTab,
} = refSelectorSlice.actions;

export default refSelectorSlice.reducer;
