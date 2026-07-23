import { render, screen } from '@testing-library/react';
import { CurrentSslStatus } from '../CurrentSslStatus';
import { vi } from 'vitest';

let mockStatus: any;
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => mockStatus,
}));

describe('CurrentSslStatus', () => {
  it('shows the domain, mode and cert expiry for letsencrypt (served cert)', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'letsencrypt', proxyMode: 'none', cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' }, wildcardCovered: true, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/letsencrypt/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });

  it('shows the domain, mode and cert expiry for paste (served cert)', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'paste', proxyMode: 'none', cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' }, wildcardCovered: true, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/paste/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });

  it('shows "Self-signed (built-in)" instead of a day-count for sslMode selfsigned, even if a stray cert/expiry is present', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'selfsigned', proxyMode: 'proxy', cert: { commonName: 'a.com', daysUntilExpiry: 89, isValid: true, expiresAt: '2026-09-01' }, wildcardCovered: false, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText(/self-signed/i)).toBeInTheDocument();
    expect(screen.queryByText(/89 days/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Certificate Expiry')).not.toBeInTheDocument();
  });

  it('still shows the "Wildcard Covered" badge for selfsigned when wildcardCovered is true (decoupled from served-cert expiry)', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'selfsigned', proxyMode: 'proxy', cert: null, wildcardCovered: true, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText('Wildcard Covered')).toBeInTheDocument();
  });
});
