import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface DomainsState {
  selectedProjectId: string | null;
  searchQuery: string;
  filterType: 'all' | 'subdomain' | 'custom';
  filterStatus: 'all' | 'active' | 'inactive';
  filterProjectId: 'all' | string;
}

const initialState: DomainsState = {
  selectedProjectId: null,
  searchQuery: '',
  filterType: 'all',
  filterStatus: 'all',
  filterProjectId: 'all',
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
    setFilterProjectId: (state, action: PayloadAction<'all' | string>) => {
      state.filterProjectId = action.payload;
    },
    resetFilters: (state) => {
      state.searchQuery = '';
      state.filterType = 'all';
      state.filterStatus = 'all';
      state.filterProjectId = 'all';
    },
  },
});

export const {
  setSelectedProjectId,
  setSearchQuery,
  setFilterType,
  setFilterStatus,
  setFilterProjectId,
  resetFilters,
} = domainsSlice.actions;

export default domainsSlice.reducer;
