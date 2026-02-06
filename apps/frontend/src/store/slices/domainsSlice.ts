import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface DomainsState {
  selectedProjectId: string | null;
  searchQuery: string;
  filterType: 'all' | 'subdomain' | 'custom';
  filterStatus: 'all' | 'active' | 'inactive';
}

const initialState: DomainsState = {
  selectedProjectId: null,
  searchQuery: '',
  filterType: 'all',
  filterStatus: 'all',
};

const domainsSlice = createSlice({
  name: 'domains',
  initialState,
  reducers: {
    setSelectedProjectId: (state, action: PayloadAction<string | null>) => {
      state.selectedProjectId = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setFilterType: (state, action: PayloadAction<'all' | 'subdomain' | 'custom'>) => {
      state.filterType = action.payload;
    },
    setFilterStatus: (state, action: PayloadAction<'all' | 'active' | 'inactive'>) => {
      state.filterStatus = action.payload;
    },
    resetFilters: (state) => {
      state.searchQuery = '';
      state.filterType = 'all';
      state.filterStatus = 'all';
    },
  },
});

export const {
  setSelectedProjectId,
  setSearchQuery,
  setFilterType,
  setFilterStatus,
  resetFilters,
} = domainsSlice.actions;

export default domainsSlice.reducer;
