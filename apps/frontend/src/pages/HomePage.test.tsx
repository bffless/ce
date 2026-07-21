import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import type { WildcardCertificateStatus } from '@/services/domainsApi';

// HomePage pulls in a lot of RTK Query hooks + Redux state; mock each at the
// module boundary (same pattern as PipelineSchedulesPage.test.tsx) so this
// test only exercises the banner-selection logic under test.
const mockGetSession = vi.fn();
const mockGetSetupStatus = vi.fn();
const mockGetWildcardStatus = vi.fn();
const mockGetMyRepositories = vi.fn();

vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => mockGetSession(),
}));

vi.mock('@/services/setupApi', () => ({
  useGetSetupStatusQuery: () => mockGetSetupStatus(),
}));

vi.mock('@/services/domainsApi', () => ({
  useGetWildcardCertificateStatusQuery: () => mockGetWildcardStatus(),
}));

vi.mock('@/services/featureFlagsApi', () => ({
  useFeatureFlags: () => ({
    isReady: true,
    isEnabled: (flag: string) =>
      flag === 'ENABLE_WILDCARD_SSL_BANNER' || flag === 'ENABLE_WILDCARD_SSL',
  }),
}));

vi.mock('@/services/repositoriesApi', () => ({
  useGetMyRepositoriesQuery: () => mockGetMyRepositories(),
}));

vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ authLogoUrl: '/logo.svg', siteName: 'BFFLESS' }),
}));

vi.mock('react-redux', async () => {
  const actual = await vi.importActual<typeof import('react-redux')>('react-redux');
  return {
    ...actual,
    useSelector: () => ({ hasCompletedOnboarding: true }),
  };
});

vi.mock('@/components/setup/onboarding/OnboardingModal', () => ({
  OnboardingModal: () => null,
}));

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

const wildcardStatus = (overrides: Partial<WildcardCertificateStatus> = {}) => ({
  data: {
    exists: true,
    daysUntilExpiry: 10,
    expiresAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as WildcardCertificateStatus,
});

describe('HomePage — wildcard SSL banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSession.mockReturnValue({
      data: { user: { email: 'admin@example.com', role: 'admin' } },
    });
    mockGetSetupStatus.mockReturnValue({ data: { isSetupComplete: true }, isLoading: false });
    mockGetMyRepositories.mockReturnValue({ data: { total: 0 } });
  });

  it('shows the "missing wildcard" banner when no certificate exists (existing behavior)', () => {
    mockGetWildcardStatus.mockReturnValue({ data: { exists: false } });
    renderHomePage();

    expect(screen.getByText('Wildcard SSL Certificate Required')).toBeInTheDocument();
  });

  it('shows the expiring-cert banner with day-count copy when the cert expires within 30 days', () => {
    mockGetWildcardStatus.mockReturnValue(wildcardStatus({ daysUntilExpiry: 12 }));
    renderHomePage();

    expect(screen.getByText('Wildcard Certificate Expiring Soon')).toBeInTheDocument();
    expect(
      screen.getByText('Wildcard certificate expires in 12 days — renew it in Settings → SSL'),
    ).toBeInTheDocument();
  });

  it('does not show any banner when the cert is healthy (> 30 days out)', () => {
    mockGetWildcardStatus.mockReturnValue(wildcardStatus({ daysUntilExpiry: 45 }));
    renderHomePage();

    expect(screen.queryByText('Wildcard SSL Certificate Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Wildcard Certificate Expiring Soon')).not.toBeInTheDocument();
  });

  it('dismissing the expiring-cert banner hides it, keyed to that cert\'s expiresAt', () => {
    mockGetWildcardStatus.mockReturnValue(
      wildcardStatus({ daysUntilExpiry: 5, expiresAt: '2026-08-01T00:00:00.000Z' }),
    );
    renderHomePage();

    expect(screen.getByText('Wildcard Certificate Expiring Soon')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Wildcard Certificate Expiring Soon')).not.toBeInTheDocument();
    expect(localStorage.getItem('ssl-banner-expiry-dismissed-2026-08-01T00:00:00.000Z')).toBe(
      'true',
    );
  });

  it('re-arms the banner for a new certificate (different expiresAt) even after a prior dismissal', () => {
    localStorage.setItem('ssl-banner-expiry-dismissed-2026-08-01T00:00:00.000Z', 'true');
    mockGetWildcardStatus.mockReturnValue(
      wildcardStatus({ daysUntilExpiry: 20, expiresAt: '2026-11-01T00:00:00.000Z' }),
    );
    renderHomePage();

    expect(screen.getByText('Wildcard Certificate Expiring Soon')).toBeInTheDocument();
  });
});
