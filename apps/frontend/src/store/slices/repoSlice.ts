import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface RepoState {
  currentRepo: {
    owner: string;
    repo: string;
  } | null;
  currentRef: string | null;
  currentFilePath: string | null;
  selectedFile: {
    path: string;
    name: string;
    size?: number;
    mimeType?: string;
  } | null;
}

const initialState: RepoState = {
  currentRepo: null,
  currentRef: null,
  currentFilePath: null,
  selectedFile: null,
};

export const repoSlice = createSlice({
  name: 'repo',
  initialState,
  reducers: {
    setCurrentRepo: (state, action: PayloadAction<{ owner: string; repo: string }>) => {
      state.currentRepo = action.payload;
    },
    setCurrentRef: (state, action: PayloadAction<string>) => {
      state.currentRef = action.payload;
    },
    setCurrentFilePath: (state, action: PayloadAction<string | null>) => {
      state.currentFilePath = action.payload;
    },
    selectFile: (
      state,
      action: PayloadAction<{
        path: string;
        name: string;
        size?: number;
        mimeType?: string;
      } | null>
    ) => {
      state.selectedFile = action.payload;
    },
    clearRepoState: (state) => {
      state.currentRepo = null;
      state.currentRef = null;
      state.currentFilePath = null;
      state.selectedFile = null;
    },
  },
});

export const {
  setCurrentRepo,
  setCurrentRef,
  setCurrentFilePath,
  selectFile,
  clearRepoState,
} = repoSlice.actions;

export default repoSlice.reducer;
