import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { OAuthConsentPage } from '../OAuthConsentPage';

const decide = vi.fn();
let pending: { data?: unknown; isLoading: boolean; error?: unknown } = { isLoading: false };

vi.mock('@/services/oauthApi', () => ({
  useGetPendingConsentQuery: () => pending,
  useDecideConsentMutation: () => [decide, { isLoading: false }],
}));

const consent = {
  clientName: 'Claude',
  scopes: ['workflow:read', 'workflow:run', 'workflow:files'],
  project: { id: 'p1', slug: 'bffless/workflow', name: 'Workflow' },
  redirectHost: 'claude.ai',
  expiresAt: '2026-09-03T00:10:00.000Z',
};

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/oauth/consent${query}`]}>
      <OAuthConsentPage />
    </MemoryRouter>,
  );
}

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending = { data: consent, isLoading: false };
    Object.defineProperty(window, 'location', { value: { assign: vi.fn() }, writable: true });
  });

  it('renders the client, the project and one checkbox per scope, all ticked', () => {
    renderAt('?request=abc');
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('bffless/workflow')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).toHaveAttribute('data-state', 'checked');
    expect(screen.getByText(/sent back to claude.ai/)).toBeInTheDocument();
  });

  it('unticking narrows the grant; Allow posts the subset and follows the redirect', async () => {
    decide.mockReturnValue({
      unwrap: () => Promise.resolve({ redirectTo: 'https://claude.ai/cb?code=x' }),
    });
    renderAt('?request=abc');
    fireEvent.click(screen.getByLabelText('workflow:run'));
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        request: 'abc',
        approve: true,
        scopes: ['workflow:read', 'workflow:files'],
      }),
    );
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('https://claude.ai/cb?code=x'),
    );
  });

  it('Deny posts approve: false', async () => {
    decide.mockReturnValue({
      unwrap: () => Promise.resolve({ redirectTo: 'https://claude.ai/cb?error=access_denied' }),
    });
    renderAt('?request=abc');
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith({ request: 'abc', approve: false }));
  });

  it('shows the error and no buttons for an invalid request', () => {
    pending = {
      isLoading: false,
      error: { data: { error_description: 'the authorization request is invalid or has expired' } },
    };
    renderAt('?request=bad');
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
  });
});
