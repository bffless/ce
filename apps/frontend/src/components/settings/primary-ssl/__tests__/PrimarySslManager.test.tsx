import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { PrimarySslManager } from '../PrimarySslManager';

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
