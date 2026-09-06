import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppTokensTab, parseScopes } from './AppTokensTab';
import type { AppToken } from '@/services/appTokensApi';

const createTrigger = vi.fn();
const revokeTrigger = vi.fn();
let listResult: { data?: AppToken[]; isLoading: boolean; error?: unknown } = {
  data: [],
  isLoading: false,
};

vi.mock('@/services/appTokensApi', () => ({
  useListAppTokensQuery: () => listResult,
  useCreateAppTokenMutation: () => [createTrigger, { isLoading: false }],
  useRevokeAppTokenMutation: () => [revokeTrigger, { isLoading: false }],
}));
vi.mock('@/services/meApi', () => ({
  useListMyProjectsQuery: () => ({
    data: [{ projectId: 'p1', projectSlug: 'bffless/workflow', projectName: 'Workflow' }],
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const token: AppToken = {
  id: 'tok-1',
  name: 'Claude — workflow',
  tokenPrefix: 'bfat_1234567',
  project: { id: 'p1', owner: 'bffless', name: 'workflow' },
  scopes: ['workflow:read', 'workflow:run'],
  kind: 'personal',
  clientId: null,
  expiresAt: '2026-12-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: '2026-09-03T00:00:00.000Z',
};

describe('parseScopes', () => {
  it('splits on whitespace and commas and de-duplicates', () => {
    expect(parseScopes('workflow:read, workflow:run  workflow:read')).toEqual([
      'workflow:read',
      'workflow:run',
    ]);
    expect(parseScopes('')).toEqual([]);
  });
});

describe('AppTokensTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listResult = { data: [token], isLoading: false };
  });

  it('renders the rows with project and scope badges', () => {
    render(<AppTokensTab />);
    expect(screen.getByText('Claude — workflow')).toBeInTheDocument();
    expect(screen.getByText('bffless/workflow')).toBeInTheDocument();
    expect(screen.getByText('workflow:run')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('shows the raw token exactly once after minting, then never again', async () => {
    createTrigger.mockReturnValue({
      unwrap: () => Promise.resolve({ data: token, token: 'bfat_rawrawraw' }),
    });
    render(<AppTokensTab />);
    fireEvent.click(screen.getByRole('button', { name: /mint token/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Claude — workflow' } });
    fireEvent.change(screen.getByLabelText('Scopes'), {
      target: { value: 'workflow:read workflow:run' },
    });
    expect(screen.getByTestId('scope-chips')).toHaveTextContent('workflow:read');

    // The only project the member belongs to is the default, so no Select interaction is needed.
    fireEvent.click(screen.getAllByRole('button', { name: /mint token/i }).at(-1)!);
    await waitFor(() =>
      expect(createTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Claude — workflow',
          project: 'bffless/workflow',
          scopes: ['workflow:read', 'workflow:run'],
        }),
      ),
    );
    const panel = await screen.findByTestId('minted-token');
    expect(panel).toHaveTextContent('only time the token is shown');
    expect(screen.getByLabelText('App token')).toHaveValue('bfat_rawrawraw');

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    await waitFor(() => expect(screen.queryByTestId('minted-token')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /mint token/i }));
    expect(screen.queryByTestId('minted-token')).toBeNull();
    expect(screen.queryByDisplayValue('bfat_rawrawraw')).toBeNull();
  });

  it('sends the dated form by default, and neverExpires (without expiresAt) when ticked', async () => {
    createTrigger.mockReturnValue({
      unwrap: () => Promise.resolve({ data: { ...token, expiresAt: null }, token: 'bfat_never' }),
    });
    render(<AppTokensTab />);
    fireEvent.click(screen.getByRole('button', { name: /mint token/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'workflow-ci' } });
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'workflow:run' } });

    const expires = screen.getByLabelText('Expires') as HTMLInputElement;
    expect(expires).not.toBeDisabled();
    expect(expires.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByTestId('never-expires-note')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /never expires/i }));
    expect(expires).toBeDisabled();
    expect(screen.getByTestId('never-expires-note')).toHaveTextContent('until you revoke it');

    fireEvent.click(screen.getAllByRole('button', { name: /mint token/i }).at(-1)!);
    await waitFor(() => expect(createTrigger).toHaveBeenCalledTimes(1));
    const body = createTrigger.mock.calls[0][0];
    expect(body).toMatchObject({ name: 'workflow-ci', neverExpires: true });
    expect(body).not.toHaveProperty('expiresAt');
    await screen.findByTestId('minted-token');
  });

  it('omits neverExpires from the body when the box is left unticked', async () => {
    createTrigger.mockReturnValue({
      unwrap: () => Promise.resolve({ data: token, token: 'bfat_dated' }),
    });
    render(<AppTokensTab />);
    fireEvent.click(screen.getByRole('button', { name: /mint token/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dated' } });
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'workflow:run' } });
    fireEvent.click(screen.getAllByRole('button', { name: /mint token/i }).at(-1)!);
    await waitFor(() => expect(createTrigger).toHaveBeenCalledTimes(1));
    const body = createTrigger.mock.calls[0][0];
    expect(body).not.toHaveProperty('neverExpires');
    expect(typeof body.expiresAt).toBe('string');
  });

  it('shows "Never" in the Expires column for a token without an expiry', () => {
    // Column order: Name, Project, Scopes, Kind, Expires, Last used, Actions.
    listResult = { data: [{ ...token, expiresAt: null }], isLoading: false };
    const { unmount } = render(<AppTokensTab />);
    let cells = screen.getByText('Claude — workflow').closest('tr')!.querySelectorAll('td');
    expect(cells[4]).toHaveTextContent('Never');
    unmount();

    listResult = { data: [token], isLoading: false };
    render(<AppTokensTab />);
    cells = screen.getByText('Claude — workflow').closest('tr')!.querySelectorAll('td');
    expect(cells[4]).not.toHaveTextContent('Never');
    expect(cells[4]).not.toHaveTextContent('—');
  });

  it('calls the revoke mutation with the id', async () => {
    revokeTrigger.mockReturnValue({ unwrap: () => Promise.resolve() });
    render(<AppTokensTab />);
    fireEvent.click(screen.getByRole('button', { name: /revoke claude — workflow/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^revoke$/i }));
    await waitFor(() => expect(revokeTrigger).toHaveBeenCalledWith('tok-1'));
  });

  it('strikes through a revoked token and hides its revoke action', () => {
    listResult = { data: [{ ...token, revokedAt: '2026-09-04T00:00:00.000Z' }], isLoading: false };
    render(<AppTokensTab />);
    expect(screen.getByText(/Revoked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke claude/i })).toBeNull();
  });
});
