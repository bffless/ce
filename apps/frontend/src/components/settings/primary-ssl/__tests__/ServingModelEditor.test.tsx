import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ServingModelEditor } from '../ServingModelEditor';

const stage = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ sans: [], wildcardCovered: true }) });
const issueLetsEncrypt = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ issued: true, reused: false }) });
const toastSpy = vi.fn();
vi.mock('@/services/primarySslApi', () => ({
  useStagePrimaryCertificateMutation: () => [stage, { isLoading: false }],
  useIssuePrimaryLetsEncryptMutation: () => [issueLetsEncrypt, { isLoading: false }],
  usePrimarySslPreflightMutation: () => [vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ ok: true, checks: [] }) }), { isLoading: false }],
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const base = { servingMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null, certificatePem: '', privateKeyPem: '' } as any;

describe('ServingModelEditor', () => {
  beforeEach(() => {
    toastSpy.mockClear();
    issueLetsEncrypt.mockClear();
    issueLetsEncrypt.mockReturnValue({ unwrap: () => Promise.resolve({ issued: true, reused: false }) });
  });

  it('changing serving mode calls onChange', () => {
    const onChange = vi.fn();
    render(<ServingModelEditor value={base} onChange={onChange} />);
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
      />,
    );
    // "none" and "proxy" both preset sslMode to 'letsencrypt' per presetSslFor;
    // click the "Directly" card (servingMode 'none').
    fireEvent.click(screen.getAllByText(/Directly/i)[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: 'letsencrypt', port80: 'redirect' }),
    );
  });

  describe('reused-vs-issued toast (Change 3)', () => {
    it('shows "Certificate already valid" when the mutation reports reused: true', async () => {
      issueLetsEncrypt.mockReturnValue({ unwrap: () => Promise.resolve({ issued: true, sans: [], reused: true }) });
      render(
        <ServingModelEditor
          value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt' }}
          onChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("Issue Let's Encrypt"));
      await waitFor(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Certificate already valid' }),
        );
      });
    });

    it('shows "New certificate issued" when the mutation reports reused: false', async () => {
      issueLetsEncrypt.mockReturnValue({ unwrap: () => Promise.resolve({ issued: true, sans: [], reused: false }) });
      render(
        <ServingModelEditor
          value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt' }}
          onChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("Issue Let's Encrypt"));
      await waitFor(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'New certificate issued' }),
        );
      });
    });
  });

  describe('Let\'s Encrypt reassurance state (Change 4)', () => {
    it('when not currently Let\'s Encrypt, renders the original "Run DNS preflight" + primary "Issue Let\'s Encrypt" flow', () => {
      render(
        <ServingModelEditor
          value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt' }}
          onChange={vi.fn()}
          isCurrentlyLetsEncrypt={false}
        />,
      );
      expect(screen.getByText(/run dns preflight/i)).toBeInTheDocument();
      expect(screen.getByText("Issue Let's Encrypt")).toBeInTheDocument();
      expect(screen.queryByText(/renew now/i)).not.toBeInTheDocument();
    });

    it('when currentCertDaysLeft is 89 (not due), the button reads "Renew now" and is disabled, and reassurance text renders', () => {
      render(
        <ServingModelEditor
          value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt' }}
          onChange={vi.fn()}
          isCurrentlyLetsEncrypt={true}
          currentCertDaysLeft={89}
        />,
      );
      expect(screen.getByText(/let's encrypt is active/i)).toBeInTheDocument();
      expect(screen.getByText(/89 days left/i)).toBeInTheDocument();
      expect(screen.getByText(/wildcard.*issued separately via dns-01/i)).toBeInTheDocument();
      const button = screen.getByRole('button', { name: /renew now/i });
      expect(button).toBeDisabled();
      expect(screen.getByText(/not due yet/i)).toBeInTheDocument();
    });

    it('when currentCertDaysLeft is 10 (due soon), the "Renew now" button is enabled', () => {
      render(
        <ServingModelEditor
          value={{ ...base, servingMode: 'none', sslMode: 'letsencrypt' }}
          onChange={vi.fn()}
          isCurrentlyLetsEncrypt={true}
          currentCertDaysLeft={10}
        />,
      );
      const button = screen.getByRole('button', { name: /renew now/i });
      expect(button).not.toBeDisabled();
    });
  });
});
