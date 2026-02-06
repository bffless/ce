import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface RepoOverviewState {
  selectedBranch: string | null;
  currentPage: number;
  sortBy: 'date' | 'branch';
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
}

const initialState: RepoOverviewState = {
  selectedBranch: null,
  currentPage: 1,
  sortBy: 'date',
  sortOrder: 'desc',
  searchQuery: '',
};

export const repoOverviewSlice = createSlice({
  name: 'repoOverview',
  initialState,
  reducers: {
    setSelectedBranch: (state, action: PayloadAction<string | null>) => {
      state.selectedBranch = action.payload;
      // Reset to page 1 when changing branch filter
      state.currentPage = 1;
    },
    setCurrentPage: (state, action: PayloadAction<number>) => {
      state.currentPage = action.payload;
    },
    setSortBy: (state, action: PayloadAction<'date' | 'branch'>) => {
      state.sortBy = action.payload;
      // Reset to page 1 when changing sort
      state.currentPage = 1;
    },
    setSortOrder: (state, action: PayloadAction<'asc' | 'desc'>) => {
      state.sortOrder = action.payload;
      // Reset to page 1 when changing sort order
      state.currentPage = 1;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
      // Reset to page 1 when searching
      state.currentPage = 1;
    },
    resetOverviewState: (state) => {
      state.selectedBranch = null;
      state.currentPage = 1;
      state.sortBy = 'date';
      state.sortOrder = 'desc';
      state.searchQuery = '';
    },
  },
});

export const {
  setSelectedBranch,
  setCurrentPage,
  setSortBy,
  setSortOrder,
  setSearchQuery,
  resetOverviewState,
} = repoOverviewSlice.actions;

export default repoOverviewSlice.reducer;
