import { createSlice } from '@reduxjs/toolkit';

export interface AuthState {
  isAuthenticated: boolean;
  isRefreshing: boolean;
  sessionExpired: boolean;
  lastRefreshAttempt: number | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  isRefreshing: false,
  sessionExpired: false,
  lastRefreshAttempt: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionExpired: (state) => {
      state.isAuthenticated = false;
      state.sessionExpired = true;
      state.isRefreshing = false;
    },
    sessionRefreshing: (state) => {
      state.isRefreshing = true;
    },
    sessionRefreshed: (state) => {
      state.isRefreshing = false;
      state.isAuthenticated = true;
      state.sessionExpired = false;
      state.lastRefreshAttempt = Date.now();
    },
    setAuthenticated: (state, action) => {
      state.isAuthenticated = action.payload;
      if (action.payload) {
        state.sessionExpired = false;
      }
    },
    resetSessionExpired: (state) => {
      state.sessionExpired = false;
    },
  },
});

export const {
  sessionExpired,
  sessionRefreshing,
  sessionRefreshed,
  setAuthenticated,
  resetSessionExpired,
} = authSlice.actions;

export default authSlice.reducer;
