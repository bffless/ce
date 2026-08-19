import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ClaimStep } from '../ClaimStep';
import { api } from '@/services/api';
import setupReducer from '@/store/slices/setupSlice';

function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

function renderClaimStep() {
  const store = createTestStore();
  return render(
    <Provider store={store}>
      <ClaimStep />
    </Provider>,
  );
}

// Restore the URL to a clean slate after every test so one test's
// `pushState` doesn't leak into the next.
afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('ClaimStep', () => {
  it('prefills the claim-token input from a `token` query param and strips it from the URL', () => {
    window.history.pushState({}, '', '/?token=testtoken123&foo=bar');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    renderClaimStep();

    const input = screen.getByLabelText('Claim token') as HTMLInputElement;
    expect(input.value).toBe('testtoken123');

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const [, , newUrl] = replaceStateSpy.mock.calls[0];
    const parsed = new URL(String(newUrl), window.location.origin);
    expect(parsed.searchParams.has('token')).toBe(false);
    // Other params and the path are preserved.
    expect(parsed.searchParams.get('foo')).toBe('bar');
    expect(parsed.pathname).toBe('/');

    replaceStateSpy.mockRestore();
  });

  it('leaves the input empty and does not touch history when no token is present', () => {
    window.history.pushState({}, '', '/');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    renderClaimStep();

    const input = screen.getByLabelText('Claim token') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(replaceStateSpy).not.toHaveBeenCalled();

    replaceStateSpy.mockRestore();
  });
});
