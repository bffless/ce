import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PrimarySslManager, splitRanges, toApplyBody, canApply } from '../PrimarySslManager';
import type { EditorState } from '../ServingModelEditor';
import type { PrimarySslStatus } from '@/services/primarySslApi';

let enabled = true;
let stagedCert: PrimarySslStatus['stagedCert'] = null;
const discardStaged = vi.fn();
const mockToast = vi.fn();
vi.mock('@/services/featureFlagsApi', () => ({
  useFeatureFlags: () => ({ isEnabled: () => enabled }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => ({
    data: {
      domain: 'a.com',
      sslMode: 'paste',
      proxyMode: 'none',
      port80: 'redirect',
      realIp: null,
      cert: null,
      stagedCert,
      wildcardCovered: false,
      pendingRevert: null,
    },
    isLoading: false,
  }),
  useApplyPrimarySslMutation: () => [vi.fn(), {}],
  useConfirmPrimarySslMutation: () => [vi.fn(), {}],
  useRollbackPrimarySslMutation: () => [vi.fn(), {}],
  useStagePrimaryCertificateMutation: () => [vi.fn(), {}],
  useIssuePrimaryLetsEncryptMutation: () => [vi.fn(), {}],
  usePrimarySslPreflightMutation: () => [vi.fn(), {}],
  useDiscardStagedCertificateMutation: () => [discardStaged, { isLoading: false }],
}));

describe('PrimarySslManager', () => {
  beforeEach(() => {
    enabled = true;
    stagedCert = null;
    discardStaged.mockClear();
    mockToast.mockClear();
  });

  it('renders when the flag is enabled', () => {
    enabled = true;
    render(<PrimarySslManager />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
  });
  it('renders nothing when the flag is disabled', () => {
    enabled = false;
    const { container } = render(<PrimarySslManager />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PrimarySslManager discard staged certificate (#512)', () => {
  beforeEach(() => {
    enabled = true;
    stagedCert = { commonName: 'staged.example.com' } as unknown as PrimarySslStatus['stagedCert'];
    discardStaged.mockClear();
    mockToast.mockClear();
  });

  it('shows a success toast when discarding succeeds', async () => {
    discardStaged.mockReturnValue({ unwrap: () => Promise.resolve({ discarded: true }) });
    render(<PrimarySslManager />);

    fireEvent.click(screen.getByRole('button', { name: /discard staged certificate/i }));

    await waitFor(() => expect(discardStaged).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Staged certificate discarded',
          description: 'The staged certificate was removed. Nothing live changed.',
        }),
      ),
    );
  });

  it('shows an error toast when discarding fails', async () => {
    discardStaged.mockReturnValue({ unwrap: () => Promise.reject({ data: { message: 'boom' } }) });
    render(<PrimarySslManager />);

    fireEvent.click(screen.getByRole('button', { name: /discard staged certificate/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', description: 'boom', variant: 'destructive' }),
      ),
    );
  });
});

describe('splitRanges', () => {
  it('splits comma-separated ranges', () => {
    expect(splitRanges('1.2.3.4/24,5.6.7.8/24')).toEqual(['1.2.3.4/24', '5.6.7.8/24']);
  });

  it('splits newline-separated ranges', () => {
    expect(splitRanges('1.2.3.4/24\n5.6.7.8/24')).toEqual(['1.2.3.4/24', '5.6.7.8/24']);
  });

  it('splits whitespace-separated ranges', () => {
    expect(splitRanges('1.2.3.4/24 5.6.7.8/24')).toEqual(['1.2.3.4/24', '5.6.7.8/24']);
  });

  it('splits mixed comma/newline/whitespace-separated ranges', () => {
    expect(splitRanges('a/24, b/24\nc/24 d/24')).toEqual(['a/24', 'b/24', 'c/24', 'd/24']);
  });

  it('returns an empty array for empty or blank input', () => {
    expect(splitRanges('')).toEqual([]);
    expect(splitRanges('   \n  ,  ')).toEqual([]);
  });
});

describe('toApplyBody', () => {
  const base: EditorState = {
    servingMode: 'proxy',
    sslMode: 'letsencrypt',
    port80: 'redirect',
    realIp: null,
    certificatePem: '',
    privateKeyPem: '',
  };

  it('includes realIp with split ranges for a proxy serving mode', () => {
    const editor: EditorState = {
      ...base,
      servingMode: 'proxy',
      sslMode: 'paste',
      port80: 'closed',
      realIp: { header: 'CF-Connecting-IP', ranges: '1.2.3.4/24 5.6.7.8/24' },
    };
    const body = toApplyBody(editor);
    expect(body.realIp).toEqual({
      header: 'CF-Connecting-IP',
      ranges: ['1.2.3.4/24', '5.6.7.8/24'],
    });
    expect(body.proxyMode).toBe('proxy');
    expect(body.sslMode).toBe('paste');
    expect(body.port80).toBe('closed');
  });

  it('includes realIp with split ranges for a direct (none) serving mode', () => {
    const editor: EditorState = {
      ...base,
      servingMode: 'none',
      realIp: { header: 'X-Forwarded-For', ranges: '10.0.0.0/8' },
    };
    const body = toApplyBody(editor);
    expect(body.realIp).toEqual({ header: 'X-Forwarded-For', ranges: ['10.0.0.0/8'] });
  });

  it('omits realIp for the cloudflare serving mode even when header/ranges are set', () => {
    const editor: EditorState = {
      ...base,
      servingMode: 'cloudflare',
      realIp: { header: 'CF-Connecting-IP', ranges: '1.2.3.4/24' },
    };
    const body = toApplyBody(editor);
    expect(body).not.toHaveProperty('realIp');
    expect(body.proxyMode).toBe('cloudflare');
  });

  it('omits realIp when the header is empty', () => {
    const editor: EditorState = {
      ...base,
      servingMode: 'proxy',
      realIp: { header: '', ranges: '1.2.3.4/24' },
    };
    const body = toApplyBody(editor);
    expect(body).not.toHaveProperty('realIp');
  });

  it('carries proxyMode/sslMode/port80 through regardless of realIp', () => {
    const editor: EditorState = {
      ...base,
      servingMode: 'none',
      sslMode: 'selfsigned',
      port80: 'closed',
    };
    const body = toApplyBody(editor);
    expect(body).toEqual({ proxyMode: 'none', sslMode: 'selfsigned', port80: 'closed' });
  });
});

describe('canApply (#512)', () => {
  const status = (over: Partial<PrimarySslStatus> = {}): PrimarySslStatus => ({
    domain: 'example.com',
    proxyMode: 'proxy',
    sslMode: 'paste',
    port80: 'closed',
    realIp: null,
    cert: { commonName: 'example.com' } as any,
    stagedCert: null,
    wildcardCovered: false,
    pendingRevert: null,
    ...over,
  });
  const editor = (over: Partial<EditorState> = {}): EditorState => ({
    servingMode: 'proxy',
    sslMode: 'paste',
    port80: 'closed',
    realIp: null,
    certificatePem: '',
    privateKeyPem: '',
    ...over,
  });

  it('selfsigned needs no cert', () => {
    expect(canApply(editor({ sslMode: 'selfsigned' }), undefined)).toBe(true);
  });
  it('a staged cert enables Apply for paste/letsencrypt', () => {
    expect(canApply(editor(), status({ stagedCert: { commonName: 'x' } as any }))).toBe(true);
    expect(
      canApply(
        editor({ sslMode: 'letsencrypt' }),
        status({ stagedCert: { commonName: 'x' } as any }),
      ),
    ).toBe(true);
  });
  it('knob-only changes on the already-active mode stay enabled (live cert present)', () => {
    expect(canApply(editor(), status())).toBe(true); // editor paste === status paste, cert present
  });
  it('switching mode with nothing staged disables Apply', () => {
    expect(canApply(editor({ sslMode: 'paste' }), status({ sslMode: 'selfsigned' }))).toBe(false);
  });
  it('no status yet (loading) disables non-selfsigned Apply', () => {
    expect(canApply(editor(), undefined)).toBe(false);
  });
  it('switching mode to letsencrypt with a live cert present stays enabled even with nothing staged (#512)', () => {
    // Issuance may legitimately reuse the still-valid live cert without ever
    // populating stagedCert, which would otherwise dead-end the Apply button.
    expect(
      canApply(
        editor({ sslMode: 'letsencrypt' }),
        status({ sslMode: 'selfsigned', stagedCert: null }),
      ),
    ).toBe(true);
  });
});
