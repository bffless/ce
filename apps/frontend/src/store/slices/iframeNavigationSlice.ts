import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface InjectionStatus {
  attempted: boolean;
  success: boolean;
  error?: string;
  reason?: 'cross-origin' | 'no-document' | 'already-injected' | 'unknown';
}

export interface StoredRoute {
  path: string;
  timestamp: number;
  commitSha?: string;
  /** Type of route: 'spa' for history API navigation, 'static' for full page navigation */
  routeType?: 'spa' | 'static';
}

export interface IframeNavigationState {
  /** Current route displayed in iframe */
  currentRoute: string | null;

  /** Whether the navigation script is ready */
  scriptReady: boolean;

  /** Status of script injection */
  injectionStatus: InjectionStatus;

  /** Routes stored per repo (key: owner/repo:filepath) */
  storedRoutes: Record<string, StoredRoute>;

  /** Status of route restoration */
  restoreStatus: 'idle' | 'pending' | 'success' | 'failed' | 'not-found';

  /** Error message if restoration failed */
  restoreError: string | null;
}

const initialState: IframeNavigationState = {
  currentRoute: null,
  scriptReady: false,
  injectionStatus: {
    attempted: false,
    success: false,
  },
  storedRoutes: {},
  restoreStatus: 'idle',
  restoreError: null,
};

export const iframeNavigationSlice = createSlice({
  name: 'iframeNavigation',
  initialState,
  reducers: {
    setCurrentRoute: (state, action: PayloadAction<string | null>) => {
      state.currentRoute = action.payload;
    },

    setScriptReady: (state, action: PayloadAction<boolean>) => {
      state.scriptReady = action.payload;
    },

    setInjectionStatus: (state, action: PayloadAction<InjectionStatus>) => {
      state.injectionStatus = action.payload;
    },

    storeRoute: (
      state,
      action: PayloadAction<{
        repoKey: string;
        path: string;
        commitSha?: string;
        routeType?: 'spa' | 'static';
      }>,
    ) => {
      const { repoKey, path, commitSha, routeType } = action.payload;
      state.storedRoutes[repoKey] = {
        path,
        timestamp: Date.now(),
        commitSha,
        routeType,
      };
    },

    clearStoredRoute: (state, action: PayloadAction<string>) => {
      delete state.storedRoutes[action.payload];
    },

    setRestoreStatus: (
      state,
      action: PayloadAction<{
        status: IframeNavigationState['restoreStatus'];
        error?: string;
      }>,
    ) => {
      state.restoreStatus = action.payload.status;
      state.restoreError = action.payload.error ?? null;
    },

    resetIframeNavigation: (state) => {
      state.currentRoute = null;
      state.scriptReady = false;
      state.injectionStatus = {
        attempted: false,
        success: false,
      };
      state.restoreStatus = 'idle';
      state.restoreError = null;
    },
  },
});

export const {
  setCurrentRoute,
  setScriptReady,
  setInjectionStatus,
  storeRoute,
  clearStoredRoute,
  setRestoreStatus,
  resetIframeNavigation,
} = iframeNavigationSlice.actions;

// Selectors
export const selectCurrentRoute = (state: { iframeNavigation: IframeNavigationState }) =>
  state.iframeNavigation.currentRoute;

export const selectScriptReady = (state: { iframeNavigation: IframeNavigationState }) =>
  state.iframeNavigation.scriptReady;

export const selectInjectionStatus = (state: { iframeNavigation: IframeNavigationState }) =>
  state.iframeNavigation.injectionStatus;

export const selectStoredRoute =
  (repoKey: string) => (state: { iframeNavigation: IframeNavigationState }) =>
    state.iframeNavigation.storedRoutes[repoKey];

export const selectRestoreStatus = (state: { iframeNavigation: IframeNavigationState }) =>
  state.iframeNavigation.restoreStatus;

export const selectRestoreError = (state: { iframeNavigation: IframeNavigationState }) =>
  state.iframeNavigation.restoreError;

export default iframeNavigationSlice.reducer;
