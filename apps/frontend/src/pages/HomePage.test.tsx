import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
const mockGetPrimarySslStatus = vi.fn();
const mockGetAppCatalog = vi.fn();

vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => mockGetSession(),
}));

vi.mock('@/services/setupApi', () => ({
  useGetSetupStatusQuery: () => mockGetSetupStatus(),
}));

vi.mock('@/services/domainsApi', () => ({
  useGetWildcardCertificateStatusQuery: () => mockGetWildcardStatus(),
}));

vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => mockGetPrimarySslStatus(),
}));

// Flipped per-test by the featured-apps suite; every other suite leaves the
// app catalog off, which is also what a CE instance without the flag sees.
let mockAppCatalogFlag = false;

vi.mock('@/services/featureFlagsApi', () => ({
  useFeatureFlags: () => ({
    isReady: true,
    isEnabled: (flag: string) =>
      flag === 'ENABLE_WILDCARD_SSL_BANNER' ||
      flag === 'ENABLE_WILDCARD_SSL' ||
      flag === 'ENABLE_PRIMARY_SSL_MANAGEMENT' ||
      (flag === 'ENABLE_APP_CATALOG' && mockAppCatalogFlag),
  }),
}));

// Honors `skip` so the tests exercise HomePage's own gating (admin + flag)
// rather than just the presence of data.
vi.mock('@/services/appCatalogApi', () => ({
  useGetAppCatalogQuery: (_arg: undefined, options?: { skip?: boolean }) =>
    options?.skip ? {} : (mockGetAppCatalog() ?? {}),
}));

// The grid itself (cards, install/details dialogs) is covered by
// AppsPage.test.tsx; here only the strip's gating and slicing matter.
vi.mock('@/components/app-catalog/AppCatalogGrid', () => ({
  AppCatalogGrid: ({ entries }: { entries: Array<{ id: string; name: string }> }) => (
    <div data-testid="app-catalog-grid">
      {entries.map((entry) => (
        <span key={entry.id}>{entry.name}</span>
      ))}
    </div>
  ),
}));

vi.mock('@/services/repositoriesApi', () => ({
  useGetMyRepositoriesQuery: () => mockGetMyRepositories(),
}));

vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ authLogoUrl: '/logo.svg', siteName: 'BFFLESS' }),
}));

const mockDispatch = vi.fn();

vi.mock('react-redux', async () => {
  const actual = await vi.importActual<typeof import('react-redux')>('react-redux');
  return {
    ...actual,
    useSelector: () => ({ hasCompletedOnboarding: true }),
    useDispatch: () => mockDispatch,
  };
});

vi.mock('@/components/setup/onboarding/OnboardingModal', () => ({
  OnboardingModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="onboarding-modal" /> : null,
}));

function renderHomePage(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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
    mockGetPrimarySslStatus.mockReturnValue({ data: undefined });
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
      screen.getByText(
        'Wildcard certificate expires in 12 days — renew it from the SSL settings below.',
      ),
    ).toBeInTheDocument();
  });

  it('does not show any banner when the cert is healthy (> 30 days out)', () => {
    mockGetWildcardStatus.mockReturnValue(wildcardStatus({ daysUntilExpiry: 45 }));
    renderHomePage();

    expect(screen.queryByText('Wildcard SSL Certificate Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Wildcard Certificate Expiring Soon')).not.toBeInTheDocument();
  });

  it("dismissing the expiring-cert banner hides it, keyed to that cert's expiresAt", () => {
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

  it('suppresses the "missing wildcard" banner when primary SSL status reports proxyMode "proxy" (behind a CDN/WAF)', () => {
    mockGetWildcardStatus.mockReturnValue({ data: { exists: false } });
    mockGetPrimarySslStatus.mockReturnValue({
      data: { proxyMode: 'proxy', sslMode: 'letsencrypt' },
    });
    renderHomePage();

    expect(screen.queryByText('Wildcard SSL Certificate Required')).not.toBeInTheDocument();
  });

  it('suppresses the banner when primary SSL status reports sslMode "selfsigned" (origin cert unverified by the edge)', () => {
    mockGetWildcardStatus.mockReturnValue({ data: { exists: false } });
    mockGetPrimarySslStatus.mockReturnValue({ data: { proxyMode: 'none', sslMode: 'selfsigned' } });
    renderHomePage();

    expect(screen.queryByText('Wildcard SSL Certificate Required')).not.toBeInTheDocument();
  });

  it('still shows the banner when primary SSL status is proxyMode "none" + sslMode "letsencrypt" (direct origin, needs its own wildcard)', () => {
    mockGetWildcardStatus.mockReturnValue({ data: { exists: false } });
    mockGetPrimarySslStatus.mockReturnValue({
      data: { proxyMode: 'none', sslMode: 'letsencrypt' },
    });
    renderHomePage();

    expect(screen.getByText('Wildcard SSL Certificate Required')).toBeInTheDocument();
  });

  it('still shows the banner (unchanged behavior) when primary SSL status is undefined (flag off, non-admin, or query error)', () => {
    mockGetWildcardStatus.mockReturnValue({ data: { exists: false } });
    mockGetPrimarySslStatus.mockReturnValue({ data: undefined });
    renderHomePage();

    expect(screen.getByText('Wildcard SSL Certificate Required')).toBeInTheDocument();
  });
});

describe('HomePage — Repositories card gating (#517)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSetupStatus.mockReturnValue({ data: { isSetupComplete: true }, isLoading: false });
    mockGetWildcardStatus.mockReturnValue({ data: undefined });
    mockGetPrimarySslStatus.mockReturnValue({ data: undefined });
  });

  const sessionWithRole = (role: 'admin' | 'user' | 'member') => ({
    data: { user: { email: `${role}@example.com`, role } },
  });

  it('shows the card for an admin with zero repos', () => {
    mockGetSession.mockReturnValue(sessionWithRole('admin'));
    mockGetMyRepositories.mockReturnValue({ data: { total: 0 } });
    renderHomePage();

    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });

  it('shows the card for a user-role account with zero repos (can create projects)', () => {
    mockGetSession.mockReturnValue(sessionWithRole('user'));
    mockGetMyRepositories.mockReturnValue({ data: { total: 0 } });
    renderHomePage();

    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });

  it('shows the card for a user-role account before the repositories query resolves', () => {
    mockGetSession.mockReturnValue(sessionWithRole('user'));
    mockGetMyRepositories.mockReturnValue({ data: undefined });
    renderHomePage();

    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });

  it('hides the card for a member with zero repo memberships (cannot create projects)', () => {
    mockGetSession.mockReturnValue(sessionWithRole('member'));
    mockGetMyRepositories.mockReturnValue({ data: { total: 0 } });
    renderHomePage();

    expect(screen.queryByText('Repositories')).not.toBeInTheDocument();
  });

  it('shows the card for a member with at least one repo membership', () => {
    mockGetSession.mockReturnValue(sessionWithRole('member'));
    mockGetMyRepositories.mockReturnValue({ data: { total: 2 } });
    renderHomePage();

    expect(screen.getByText('Repositories')).toBeInTheDocument();
  });
});

describe('HomePage — ?onboarding=1 developer override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSession.mockReturnValue({
      data: { user: { email: 'admin@example.com', role: 'admin' } },
    });
    mockGetSetupStatus.mockReturnValue({ data: { isSetupComplete: true }, isLoading: false });
    mockGetWildcardStatus.mockReturnValue({ data: undefined });
    mockGetPrimarySslStatus.mockReturnValue({ data: undefined });
    // Established workspace: repos exist, so the normal auto-show guard
    // (hasNoRepos) can never pass — only the override can open the modal.
    mockGetMyRepositories.mockReturnValue({ data: { total: 3 } });
  });

  it('force-opens the modal past the completed flag and repo-count guards, resetting the wizard', () => {
    renderHomePage(['/?onboarding=1']);

    expect(screen.getByTestId('onboarding-modal')).toBeInTheDocument();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setup/resetOnboarding' }),
    );
  });

  it('does not open the modal without the param (completed flag set, repos exist)', () => {
    renderHomePage();

    expect(screen.queryByTestId('onboarding-modal')).not.toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('ignores other values of the param (e.g. ?onboarding=0)', () => {
    renderHomePage(['/?onboarding=0']);

    expect(screen.queryByTestId('onboarding-modal')).not.toBeInTheDocument();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('HomePage — featured apps strip', () => {
  const catalog = (names: string[]) => ({
    data: { data: names.map((name) => ({ id: name.toLowerCase(), name })) },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAppCatalogFlag = true;
    mockGetSession.mockReturnValue({
      data: { user: { email: 'admin@example.com', role: 'admin' } },
    });
    mockGetSetupStatus.mockReturnValue({ data: { isSetupComplete: true }, isLoading: false });
    mockGetWildcardStatus.mockReturnValue({ data: undefined });
    mockGetPrimarySslStatus.mockReturnValue({ data: undefined });
    mockGetMyRepositories.mockReturnValue({ data: { total: 1 } });
    mockGetAppCatalog.mockReturnValue(catalog(['Handoff', 'Rivulet', 'Studio']));
  });

  afterEach(() => {
    mockAppCatalogFlag = false;
  });

  it('shows the catalog apps with a link through to the full page', () => {
    renderHomePage();

    const grid = screen.getByTestId('app-catalog-grid');
    expect(within(grid).getByText('Handoff')).toBeInTheDocument();
    expect(within(grid).getByText('Rivulet')).toBeInTheDocument();
    expect(within(grid).getByText('Studio')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all apps' })).toHaveAttribute('href', '/apps');
  });

  it('previews only the first three apps', () => {
    mockGetAppCatalog.mockReturnValue(catalog(['Handoff', 'Rivulet', 'Studio', 'Fourth']));
    renderHomePage();

    const grid = screen.getByTestId('app-catalog-grid');
    expect(within(grid).getByText('Studio')).toBeInTheDocument();
    expect(within(grid).queryByText('Fourth')).not.toBeInTheDocument();
  });

  it('renders nothing when the catalog is empty (no loading/empty chrome on the home page)', () => {
    mockGetAppCatalog.mockReturnValue({ data: { data: [] } });
    renderHomePage();

    expect(screen.queryByTestId('app-catalog-grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View all apps' })).not.toBeInTheDocument();
  });

  it('skips the catalog query entirely when ENABLE_APP_CATALOG is off', () => {
    mockAppCatalogFlag = false;
    renderHomePage();

    expect(mockGetAppCatalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('app-catalog-grid')).not.toBeInTheDocument();
  });

  it('skips the catalog query for non-admins (the endpoint is admin-only)', () => {
    mockGetSession.mockReturnValue({ data: { user: { email: 'u@example.com', role: 'user' } } });
    renderHomePage();

    expect(mockGetAppCatalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('app-catalog-grid')).not.toBeInTheDocument();
  });
});
