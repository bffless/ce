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

  it('does not render "Close port 80" when sslMode is letsencrypt (HTTP-01 needs port 80 open)', () => {
    const onChange = vi.fn();
    render(
      <ServingModelEditor
        value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt', port80: 'redirect' }}
        onChange={onChange}
        onCertStaged={vi.fn()}
      />,
    );
    expect(screen.queryByRole('radio', { name: /close port 80/i })).not.toBeInTheDocument();
    expect(screen.getByText(/port 80 stays open/i)).toBeInTheDocument();
  });

  it('renders "Close port 80" when sslMode is not letsencrypt', () => {
    const onChange = vi.fn();
    render(
      <ServingModelEditor
        value={{ ...base, servingMode: 'none', sslMode: 'paste', port80: 'redirect' }}
        onChange={onChange}
        onCertStaged={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /close port 80/i })).toBeInTheDocument();
  });

  it('reactively forces port80 to redirect when seeded with letsencrypt + closed', () => {
    const onChange = vi.fn();
    render(
      <ServingModelEditor
        value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt', port80: 'closed' }}
        onChange={onChange}
        onCertStaged={vi.fn()}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: 'letsencrypt', port80: 'redirect' }),
    );
  });

  it('switching to a serving mode that presets letsencrypt forces port80 to redirect in the onChange payload', () => {
    const onChange = vi.fn();
    render(
      <ServingModelEditor
        value={{ ...base, servingMode: 'proxy', sslMode: 'selfsigned', port80: 'closed' }}
        onChange={onChange}
        onCertStaged={vi.fn()}
      />,
    );
    // "none" and "proxy" both preset sslMode to 'letsencrypt' per presetSslFor;
    // click the "Directly" card (servingMode 'none').
    fireEvent.click(screen.getAllByText(/Directly/i)[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: 'letsencrypt', port80: 'redirect' }),
    );
  });
});
