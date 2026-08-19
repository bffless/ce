import { render, screen } from '@testing-library/react';
import { CurrentSslStatus } from '../CurrentSslStatus';
import { vi } from 'vitest';

let mockStatus: any;
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => mockStatus,
}));

describe('CurrentSslStatus', () => {
  it('shows the domain, mode and cert expiry for letsencrypt (served cert)', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'letsencrypt',
        proxyMode: 'none',
        cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' },
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/let's encrypt/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });

  it('shows the domain, mode and cert expiry for paste (served cert)', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'paste',
        proxyMode: 'none',
        cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' },
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/pasted \(bring-your-own\)/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });

  it('shows "Self-signed (built-in)" instead of a day-count for sslMode selfsigned, even if a stray cert/expiry is present', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'selfsigned',
        proxyMode: 'proxy',
        cert: { commonName: 'a.com', daysUntilExpiry: 89, isValid: true, expiresAt: '2026-09-01' },
        wildcardCovered: false,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText(/self-signed/i)).toBeInTheDocument();
    expect(screen.queryByText(/89 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Certificate Expiry')).not.toBeInTheDocument();
  });

  it('renders Traffic "Through a CDN or WAF" + Certificate "Self-signed (built-in)", NO day count, and NO wildcard badge for {proxyMode:proxy, sslMode:selfsigned}', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'selfsigned',
        proxyMode: 'proxy',
        cert: { commonName: 'a.com', daysUntilExpiry: 89, isValid: true, expiresAt: '2026-09-01' },
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    expect(screen.getByText('Through a CDN or WAF')).toBeInTheDocument();
    expect(screen.getByText('Certificate')).toBeInTheDocument();
    expect(screen.getByText('Self-signed (built-in)')).toBeInTheDocument();
    expect(screen.queryByText(/89 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Wildcard Covered')).not.toBeInTheDocument();
  });

  it('renders Traffic "Directly" + Certificate "Let\'s Encrypt", shows expiry, and allows the wildcard badge for {proxyMode:none, sslMode:letsencrypt}', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'letsencrypt',
        proxyMode: 'none',
        cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' },
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    expect(screen.getByText('Directly')).toBeInTheDocument();
    expect(screen.getByText('Certificate')).toBeInTheDocument();
    expect(screen.getByText("Let's Encrypt")).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
    expect(screen.getByText('Wildcard Covered')).toBeInTheDocument();
  });

  it('does not show the "Wildcard Covered" badge in selfsigned mode even when a wildcard file exists on disk', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'selfsigned',
        proxyMode: 'proxy',
        cert: null,
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.queryByText('Wildcard Covered')).not.toBeInTheDocument();
  });

  it('shows the "Wildcard Covered" badge for non-selfsigned modes when wildcardCovered is true', () => {
    mockStatus = {
      data: {
        domain: 'a.com',
        sslMode: 'paste',
        proxyMode: 'proxy',
        cert: null,
        wildcardCovered: true,
        pendingRevert: null,
      },
      isLoading: false,
    };
    render(<CurrentSslStatus />);
    expect(screen.getByText('Wildcard Covered')).toBeInTheDocument();
  });
});
