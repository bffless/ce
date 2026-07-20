import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { DomainSslStep } from '../DomainSslStep';
import { api } from '@/services/api';
import setupReducer, { setClaimToken } from '@/store/slices/setupSlice';

const uploadMock = vi.fn();
const useUploadCertificatesMutationMock = vi.fn();

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useUploadCertificatesMutation: () => useUploadCertificatesMutationMock(),
  };
});

function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      setup: setupReducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

function renderStep(claimToken?: string) {
  const store = createTestStore();
  if (claimToken) store.dispatch(setClaimToken(claimToken));
  render(
    <Provider store={store}>
      <DomainSslStep />
    </Provider>
  );
  return store;
}

// window.location is shared, mutable global state. Save the real descriptor
// once and restore it after every test so a stubbed hostname here can never
// leak into another test file in the same run (47 files / 519 tests share a
// worker pool).
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, hostname },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', originalLocationDescriptor);
});

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockReturnValue({ unwrap: () => Promise.resolve({ saved: true, sans: [] }) });
  useUploadCertificatesMutationMock.mockReset();
  useUploadCertificatesMutationMock.mockReturnValue([uploadMock, { isLoading: false }]);
});

describe('DomainSslStep', () => {
  it('pre-fills domain from hostname, stripping a leading admin.', () => {
    setHostname('admin.example.com');
    renderStep();
    expect(screen.getByLabelText(/domain/i)).toHaveValue('example.com');
  });

  it('pre-fills domain from hostname, stripping a leading www.', () => {
    setHostname('www.example.com');
    renderStep();
    expect(screen.getByLabelText(/domain/i)).toHaveValue('example.com');
  });

  it('leaves domain empty when arriving via a bare IP', () => {
    setHostname('203.0.113.10');
    renderStep();
    expect(screen.getByLabelText(/domain/i)).toHaveValue('');
  });

  it('leaves domain empty when arriving via localhost', () => {
    setHostname('localhost');
    renderStep();
    expect(screen.getByLabelText(/domain/i)).toHaveValue('');
  });

  it('submits {domain, certificatePem, privateKeyPem, claim token} and advances on success', async () => {
    setHostname('admin.example.com');
    // Seed the claim token as the claim step would: the wizard is session-less,
    // so cert upload carries the token as its auth (see Option C — token-gated
    // cert/apply). Asserting it explicitly proves the store value is forwarded,
    // not just that undefined is tolerated.
    const store = renderStep('claim-xyz');

    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /install certificate/i }));

    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith({
        domain: 'example.com',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        token: 'claim-xyz',
      })
    );

    await waitFor(() => {
      expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
      // Advanced from the initial (unset) position to the next step in the
      // default stepOrder — see setupSlice.ts's initialState comment.
      expect(store.getState().setup.wizard.currentStepId).toBe('storage');
    });
  });

  it('trims leading/trailing whitespace from the domain before submitting', async () => {
    setHostname('localhost'); // domain starts empty so we control it exactly
    const store = renderStep();

    fireEvent.change(screen.getByLabelText(/domain/i), { target: { value: '  example.com  ' } });
    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /install certificate/i }));

    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith({
        domain: 'example.com',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
      })
    );
    expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
  });

  it('surfaces the backend error message and does not advance on failure', async () => {
    setHostname('admin.example.com');
    const message =
      'Certificate does not cover *.example.com — recreate it in Cloudflare with both example.com and *.example.com as hostnames.';
    uploadMock.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message } }),
    });
    const store = renderStep();

    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /install certificate/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());

    expect(store.getState().setup.wizard.bootstrapDomain).toBeNull();
    expect(store.getState().setup.wizard.currentStepId).toBeNull();
  });

  it('falls back to a generic message when the backend error has none', async () => {
    setHostname('admin.example.com');
    uploadMock.mockReturnValue({ unwrap: () => Promise.reject({}) });
    renderStep();

    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
    fireEvent.click(screen.getByRole('button', { name: /install certificate/i }));

    await waitFor(() =>
      expect(screen.getByText(/certificate validation failed/i)).toBeInTheDocument()
    );
  });

  it('disables the submit button until domain, cert, and key are all present', () => {
    setHostname('localhost'); // domain starts empty
    renderStep();

    const submit = screen.getByRole('button', { name: /install certificate/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/domain/i), { target: { value: 'example.com' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
    expect(submit).not.toBeDisabled();
  });

  it('disables the submit button while the mutation is loading', () => {
    useUploadCertificatesMutationMock.mockReturnValue([uploadMock, { isLoading: true }]);
    setHostname('admin.example.com');
    renderStep();

    fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });

    expect(screen.getByRole('button', { name: /validating/i })).toBeDisabled();
  });
});
