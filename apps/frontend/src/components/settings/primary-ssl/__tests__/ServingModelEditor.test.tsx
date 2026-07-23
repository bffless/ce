import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ServingModelEditor } from '../ServingModelEditor';

const stage = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ sans: [], wildcardCovered: true }) });
vi.mock('@/services/primarySslApi', () => ({
  useStagePrimaryCertificateMutation: () => [stage, { isLoading: false }],
  useIssuePrimaryLetsEncryptMutation: () => [vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ issued: true }) }), { isLoading: false }],
  usePrimarySslPreflightMutation: () => [vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ ok: true, checks: [] }) }), { isLoading: false }],
}));

const base = { servingMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null, certificatePem: '', privateKeyPem: '' } as any;

describe('ServingModelEditor', () => {
  it('changing serving mode calls onChange', () => {
    const onChange = vi.fn();
    render(<ServingModelEditor value={base} onChange={onChange} onCertStaged={vi.fn()} />);
    // ServingChoiceCards' Cloudflare card has "Cloudflare" in both its title
    // and body text, so getByText alone is ambiguous — click within the
    // wrapping <label> (native label→input forwarding still selects the
    // radio) via the first match.
    fireEvent.click(screen.getAllByText(/Cloudflare/i)[0]);
    expect(onChange).toHaveBeenCalled();
  });
});
