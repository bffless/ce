import { describe, it, expect } from 'vitest';
import authReducer, {
  sessionExpired,
  sessionRefreshing,
  sessionRefreshed,
  setAuthenticated,
  resetSessionExpired,
  AuthState,
} from './authSlice';

describe('authSlice', () => {
  const initialState: AuthState = {
    isAuthenticated: false,
    isRefreshing: false,
    sessionExpired: false,
    lastRefreshAttempt: null,
  };

  describe('sessionExpired', () => {
    it('should mark session as expired and not authenticated', () => {
      const state = authReducer(
        { ...initialState, isAuthenticated: true, isRefreshing: true },
        sessionExpired()
      );
      expect(state.isAuthenticated).toBe(false);
      expect(state.sessionExpired).toBe(true);
      expect(state.isRefreshing).toBe(false);
    });
  });

  describe('sessionRefreshing', () => {
    it('should mark session as refreshing', () => {
      const state = authReducer(initialState, sessionRefreshing());
      expect(state.isRefreshing).toBe(true);
    });
  });

  describe('sessionRefreshed', () => {
    it('should mark session as refreshed and authenticated', () => {
      const state = authReducer(
        { ...initialState, sessionExpired: true },
        sessionRefreshed()
      );
      expect(state.isRefreshing).toBe(false);
      expect(state.isAuthenticated).toBe(true);
      expect(state.sessionExpired).toBe(false);
      expect(state.lastRefreshAttempt).toBeGreaterThan(0);
    });

    it('should update lastRefreshAttempt timestamp', () => {
      const before = Date.now();
      const state = authReducer(initialState, sessionRefreshed());
      const after = Date.now();
      expect(state.lastRefreshAttempt).toBeGreaterThanOrEqual(before);
      expect(state.lastRefreshAttempt).toBeLessThanOrEqual(after);
    });
  });

  describe('setAuthenticated', () => {
    it('should set authenticated to true', () => {
      const state = authReducer(initialState, setAuthenticated(true));
      expect(state.isAuthenticated).toBe(true);
      expect(state.sessionExpired).toBe(false);
    });

    it('should set authenticated to false', () => {
      const state = authReducer(
        { ...initialState, isAuthenticated: true },
        setAuthenticated(false)
      );
      expect(state.isAuthenticated).toBe(false);
    });

    it('should clear sessionExpired when setting authenticated to true', () => {
      const state = authReducer(
        { ...initialState, sessionExpired: true },
        setAuthenticated(true)
      );
      expect(state.sessionExpired).toBe(false);
    });
  });

  describe('resetSessionExpired', () => {
    it('should reset sessionExpired flag', () => {
      const state = authReducer(
        { ...initialState, sessionExpired: true },
        resetSessionExpired()
      );
      expect(state.sessionExpired).toBe(false);
    });
  });

  describe('session refresh flow', () => {
    it('should handle complete refresh flow', () => {
      // Start with authenticated state
      let state: AuthState = { ...initialState, isAuthenticated: true };

      // Begin refresh
      state = authReducer(state, sessionRefreshing());
      expect(state.isRefreshing).toBe(true);

      // Refresh succeeds
      state = authReducer(state, sessionRefreshed());
      expect(state.isRefreshing).toBe(false);
      expect(state.isAuthenticated).toBe(true);
      expect(state.lastRefreshAttempt).toBeGreaterThan(0);
    });

    it('should handle refresh failure leading to session expiration', () => {
      // Start with authenticated state, begin refresh
      let state: AuthState = { ...initialState, isAuthenticated: true };
      state = authReducer(state, sessionRefreshing());

      // Refresh fails - session expires
      state = authReducer(state, sessionExpired());
      expect(state.isRefreshing).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.sessionExpired).toBe(true);
    });
  });
});
