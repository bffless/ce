import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { PrimarySslManager, splitRanges, toApplyBody } from '../PrimarySslManager';
import type { EditorState } from '../ServingModelEditor';

let enabled = true;
vi.mock('@/services/featureFlagsApi', () => ({ useFeatureFlags: () => ({ isEnabled: () => enabled }) }));
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => ({ data: { domain: 'a.com', sslMode: 'paste', proxyMode: 'none', port80: 'redirect', realIp: null, cert: null, wildcardCovered: false, pendingRevert: null }, isLoading: false }),
  useApplyPrimarySslMutation: () => [vi.fn(), {}],
  useConfirmPrimarySslMutation: () => [vi.fn(), {}],
  useRollbackPrimarySslMutation: () => [vi.fn(), {}],
  useStagePrimaryCertificateMutation: () => [vi.fn(), {}],
  useIssuePrimaryLetsEncryptMutation: () => [vi.fn(), {}],
  usePrimarySslPreflightMutation: () => [vi.fn(), {}],
}));

describe('PrimarySslManager', () => {
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
    expect(body.realIp).toEqual({ header: 'CF-Connecting-IP', ranges: ['1.2.3.4/24', '5.6.7.8/24'] });
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
    const editor: EditorState = { ...base, servingMode: 'none', sslMode: 'selfsigned', port80: 'closed' };
    const body = toApplyBody(editor);
    expect(body).toEqual({ proxyMode: 'none', sslMode: 'selfsigned', port80: 'closed' });
  });
});
