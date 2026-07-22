import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CertificatePhase } from '../domain-ssl/CertificatePhase';
import { api } from '@/services/api';
import setupReducer, {
  ServingMode,
  BootstrapSslMode,
  setServingMode,
  setBootstrapSslMode,
  setDnsPreflightPassed,
} from '@/store/slices/setupSlice';

// This codebase has no MSW harness — RTK Query hooks are mocked directly, the
// same pattern DomainSslStep.test.tsx / ApplyStep.test.tsx use.
const uploadMock = vi.fn();
const useUploadCertificatesMutationMock = vi.fn();
const issueMock = vi.fn();
const useIssueCertificateMutationMock = vi.fn();
const startWildcardMock = vi.fn();
const useStartWildcardMutationMock = vi.fn();
const completeWildcardMock = vi.fn();
const useCompleteWildcardMutationMock = vi.fn();

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/setupApi')>();
  return {
    ...mod,
    useUploadCertificatesMutation: () => useUploadCertificatesMutationMock(),
    useIssueCertificateMutation: () => useIssueCertificateMutationMock(),
    useStartWildcardMutation: () => useStartWildcardMutationMock(),
    useCompleteWildcardMutation: () => useCompleteWildcardMutationMock(),
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

// Mirrors the brief's `renderWithStore(<X/>, overrides)` helper, adapted to
// this repo's dispatch-based (non-MSW) test harness — preload wizard state
// via the same reducer actions the earlier phases would dispatch.
function renderWithStore(
  ui: React.ReactElement,
  wizardOverrides: Partial<{
    servingMode: ServingMode | null;
    bootstrapSslMode: BootstrapSslMode | null;
    dnsPreflightPassed: boolean;
  }> = {}
) {
  const store = createTestStore();
  if (wizardOverrides.servingMode !== undefined && wizardOverrides.servingMode !== null) {
    store.dispatch(setServingMode(wizardOverrides.servingMode));
  }
  if (wizardOverrides.bootstrapSslMode !== undefined) {
    store.dispatch(setBootstrapSslMode(wizardOverrides.bootstrapSslMode));
  }
  if (wizardOverrides.dnsPreflightPassed !== undefined) {
    store.dispatch(setDnsPreflightPassed(wizardOverrides.dnsPreflightPassed));
  }
  render(<Provider store={store}>{ui}</Provider>);
  return store;
}

const noop = () => {};

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockReturnValue({
    unwrap: () => Promise.resolve({ saved: true, sans: ['example.com'], wildcardCovered: true }),
  });
  useUploadCertificatesMutationMock.mockReset();
  useUploadCertificatesMutationMock.mockReturnValue([uploadMock, { isLoading: false }]);

  issueMock.mockReset();
  issueMock.mockReturnValue({
    unwrap: () =>
      Promise.resolve({ issued: true, sans: ['example.com', 'www.example.com', 'admin.example.com'] }),
  });
  useIssueCertificateMutationMock.mockReset();
  useIssueCertificateMutationMock.mockReturnValue([issueMock, { isLoading: false }]);

  startWildcardMock.mockReset();
  startWildcardMock.mockReturnValue({
    unwrap: () =>
      Promise.resolve({
        recordName: '_acme-challenge.example.com',
        recordValues: ['abc', 'def'],
        expiresAt: '2026-08-01T00:00:00Z',
      }),
  });
  useStartWildcardMutationMock.mockReset();
  useStartWildcardMutationMock.mockReturnValue([startWildcardMock, { isLoading: false }]);

  completeWildcardMock.mockReset();
  completeWildcardMock.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
  useCompleteWildcardMutationMock.mockReset();
  useCompleteWildcardMutationMock.mockReturnValue([completeWildcardMock, { isLoading: false }]);
});

afterEach(() => {
  cleanup();
});

describe('CertificatePhase', () => {
  it('cloudflare path shows the Origin Certificate copy referencing the Cloudflare dashboard', () => {
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, { servingMode: 'cloudflare' });
    expect(screen.getByText(/cloudflare dashboard/i)).toBeInTheDocument();
    expect(screen.queryByText(/restore visitor ips/i)).not.toBeInTheDocument();
  });

  it('proxy path renders neutral copy and the visitor-IP option', () => {
    // servingMode 'proxy' now defaults bootstrapSslMode to 'selfsigned'
    // (Task 5); explicitly select 'paste' here to exercise the
    // PasteCertificateForm cert-upload path.
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });
    expect(screen.getByText(/your cdn's origin certificate/i)).toBeInTheDocument();
    expect(screen.getByText(/restore visitor ips/i)).toBeInTheDocument();
    expect(screen.queryByText(/cloudflare dashboard/i)).not.toBeInTheDocument();
  });

  it('proxy + selfsigned shows a confirm view (no cert upload) and advances', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'selfsigned',
    });
    expect(screen.queryByLabelText(/certificate.*pem/i)).not.toBeInTheDocument();
    expect(screen.getByText(/built-in certificate/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
  });

  it('proxy path shows the visitor-IP / port-80 options for the self-signed mode too', () => {
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'selfsigned',
    });
    expect(screen.getByText(/restore visitor ips/i)).toBeInTheDocument();
    expect(screen.getByText(/close port 80/i)).toBeInTheDocument();
  });

  it('proxy options dispatch a valid realIp to the store', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'selfsigned',
    });
    // Details starts collapsed — open it before the fields inside are queryable.
    await user.click(screen.getByText(/restore visitor ips/i));
    await user.type(screen.getByLabelText(/trusted ranges/i), '151.101.0.0/16');
    await user.type(screen.getByLabelText(/header carrying/i), 'True-Client-IP');
    await waitFor(() =>
      expect(store.getState().setup.wizard.bootstrapRealIp).toEqual({
        header: 'True-Client-IP',
        ranges: ['151.101.0.0/16'],
      })
    );
  });

  it('none/paste path renders browser-trusted copy with no visitor-IP option', () => {
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'paste',
    });
    expect(screen.getByText(/browser-trusted certificate/i)).toBeInTheDocument();
    expect(screen.queryByText(/restore visitor ips/i)).not.toBeInTheDocument();
  });

  it('proxy path dispatches realIp/port80 to the store before uploading', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/^origin certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');

    await user.click(screen.getByText(/restore visitor ips/i));
    await user.type(screen.getByLabelText(/trusted ranges/i), '151.101.0.0/16');
    await user.click(screen.getByLabelText(/close port 80/i));

    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'example.com',
        certificatePem: 'CERT-PEM',
        privateKeyPem: 'KEY-PEM',
        servingMode: 'proxy',
      })
    );
    expect(store.getState().setup.wizard.bootstrapRealIp).toEqual({
      header: 'X-Forwarded-For',
      ranges: ['151.101.0.0/16'],
    });
    expect(store.getState().setup.wizard.bootstrapPort80).toBe('closed');
  });

  it('proxy path clears realIp when the ranges textarea is left empty', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/^origin certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');
    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(store.getState().setup.wizard.bootstrapRealIp).toBeNull();
  });

  // NOTE: PasteCertificateForm previously HARD-BLOCKED submit on an invalid
  // realIp (the validation lived inside its own submit()). Since ProxyOptions
  // was extracted as an independent, always-mounted control (Task 6), the
  // realIp fields are OPTIONAL: invalid input shows an inline error and is
  // dispatched as null (not applied), but no longer blocks the surrounding
  // cert form's own submit — the backend's combo-validation at Apply time is
  // the authoritative gate. These two tests are updated accordingly.
  it('proxy path shows an inline error for an invalid CIDR range but still allows the cert upload to proceed', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/^origin certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');
    await user.click(screen.getByText(/restore visitor ips/i));
    // No prefix — the classic "looks like a CIDR but isn't" mistake.
    await user.type(screen.getByLabelText(/trusted ranges/i), '10.0.0.1');

    expect(await screen.findByText(/invalid cidr range/i)).toBeInTheDocument();
    expect(store.getState().setup.wizard.bootstrapRealIp).toBeNull();

    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(uploadMock).toHaveBeenCalled();
    expect(store.getState().setup.wizard.bootstrapRealIp).toBeNull();
  });

  it('proxy path shows an inline error for a header containing a space but still allows the cert upload to proceed', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/^origin certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');
    await user.click(screen.getByText(/restore visitor ips/i));
    await user.type(screen.getByLabelText(/trusted ranges/i), '151.101.0.0/16');
    await user.type(screen.getByLabelText(/header carrying the visitor ip/i), 'X Forwarded For');

    expect(await screen.findByText(/valid http header name/i)).toBeInTheDocument();
    expect(store.getState().setup.wizard.bootstrapRealIp).toBeNull();

    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(uploadMock).toHaveBeenCalled();
    expect(store.getState().setup.wizard.bootstrapRealIp).toBeNull();
  });

  it('proxy path proceeds and dispatches realIp when ranges + header are valid', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'proxy',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/^origin certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');
    await user.click(screen.getByText(/restore visitor ips/i));
    await user.type(
      screen.getByLabelText(/trusted ranges/i),
      '151.101.0.0/16{enter}2a04:4e40::/32'
    );
    await user.type(screen.getByLabelText(/header carrying the visitor ip/i), 'CF-Connecting-IP');
    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(uploadMock).toHaveBeenCalled();
    expect(store.getState().setup.wizard.bootstrapRealIp).toEqual({
      header: 'CF-Connecting-IP',
      ranges: ['151.101.0.0/16', '2a04:4e40::/32'],
    });
  });

  it('BYO path warns but proceeds without a wildcard SAN', async () => {
    const user = userEvent.setup();
    uploadMock.mockReturnValue({
      unwrap: () => Promise.resolve({ saved: true, sans: ['example.com'], wildcardCovered: false }),
    });
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'paste',
    });

    await user.type(screen.getByLabelText(/certificate/i), 'CERT-PEM');
    await user.type(screen.getByLabelText(/private key/i), 'KEY-PEM');
    await user.click(screen.getByRole('button', { name: /upload certificate/i }));

    expect(
      await screen.findByText(/preview subdomains will show a certificate warning/i)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue anyway/i }));
    expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
  });

  it('LE path issues then offers the wildcard sub-step with TXT records', async () => {
    const user = userEvent.setup();
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
    });
    await user.click(screen.getByRole('button', { name: /issue certificate/i }));
    expect(await screen.findByText(/certificate issued/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add a wildcard/i }));
    expect(await screen.findByText('_acme-challenge.example.com')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
    // The record is presented as labeled Name/Value fields (not two bare lines),
    // with the host-only form spelled out for providers that append the domain.
    expect(screen.getByText('Name / Host')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('_acme-challenge')).toBeInTheDocument();
  });

  it('LE wildcard verify completes and advances with wildcardIssued=true', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
    });
    await user.click(screen.getByRole('button', { name: /issue certificate/i }));
    await user.click(await screen.findByRole('button', { name: /add a wildcard/i }));
    await screen.findByText('_acme-challenge.example.com');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(completeWildcardMock).toHaveBeenCalled();
    expect(store.getState().setup.wizard.wildcardIssued).toBe(true);
    expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
  });

  it('LE wildcard verify failure is retryable', async () => {
    const user = userEvent.setup();
    completeWildcardMock.mockReturnValueOnce({
      unwrap: () => Promise.reject({ data: { message: 'not propagated yet' } }),
    });
    renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
    });
    await user.click(screen.getByRole('button', { name: /issue certificate/i }));
    await user.click(await screen.findByRole('button', { name: /add a wildcard/i }));
    await screen.findByText('_acme-challenge.example.com');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText(/not propagated yet/i)).toBeInTheDocument();
    // still retryable — the records + verify button remain
    expect(screen.getByText('_acme-challenge.example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  it('LE wildcard skip advances with wildcardIssued=false', async () => {
    const user = userEvent.setup();
    const store = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
      servingMode: 'none',
      bootstrapSslMode: 'letsencrypt',
      dnsPreflightPassed: true,
    });
    await user.click(screen.getByRole('button', { name: /issue certificate/i }));
    await user.click(await screen.findByRole('button', { name: /skip for now/i }));

    expect(store.getState().setup.wizard.wildcardIssued).toBe(false);
    expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
  });
});
