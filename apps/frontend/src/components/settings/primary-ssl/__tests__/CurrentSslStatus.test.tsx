import { render, screen } from '@testing-library/react';
import { CurrentSslStatus } from '../CurrentSslStatus';
import { vi } from 'vitest';

let mockStatus: any;
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => mockStatus,
}));

describe('CurrentSslStatus', () => {
  it('shows the domain, mode and cert expiry', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'paste', proxyMode: 'none', cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' }, wildcardCovered: true, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/paste/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });
});
