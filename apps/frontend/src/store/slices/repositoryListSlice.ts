import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface RepositoryListState {
  // Sidebar state
  sidebarSearch: string; // Client-side filter for sidebar

  // Feed state
  feedSearch: string; // Server-side search for feed
  currentPage: number;
  sortBy: 'updatedAt' | 'createdAt' | 'name';
  sortOrder: 'asc' | 'desc';
}

const initialState: RepositoryListState = {
  sidebarSearch: '',
  feedSearch: '',
  currentPage: 1,
  sortBy: 'updatedAt',
  sortOrder: 'desc',
};

export const repositoryListSlice = createSlice({
  name: 'repositoryList',
  initialState,
  reducers: {
    setSidebarSearch: (state, action: PayloadAction<string>) => {
      state.sidebarSearch = action.payload;
    },
    setFeedSearch: (state, action: PayloadAction<string>) => {
      state.feedSearch = action.payload;
      state.currentPage = 1; // Reset pagination on search
    },
    setCurrentPage: (state, action: PayloadAction<number>) => {
      state.currentPage = action.payload;
    },
    setSortBy: (state, action: PayloadAction<'updatedAt' | 'createdAt' | 'name'>) => {
      state.sortBy = action.payload;
      state.currentPage = 1; // Reset pagination on sort change
    },
    setSortOrder: (state, action: PayloadAction<'asc' | 'desc'>) => {
      state.sortOrder = action.payload;
      state.currentPage = 1; // Reset pagination on order change
    },
  },
});

export const {
  setSidebarSearch,
  setFeedSearch,
  setCurrentPage,
  setSortBy,
  setSortOrder,
} = repositoryListSlice.actions;

export default repositoryListSlice.reducer;
