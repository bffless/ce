import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RemoteConnectionsSettings } from './RemoteConnectionsSettings';

const create = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const remove = vi.fn(() => ({ unwrap: () => Promise.resolve(undefined) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testResult: any;
const test = vi.fn(() => ({ unwrap: () => Promise.resolve(testResult) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let connections: any[];

vi.mock('@/services/settingsApi', () => ({
  useListRemoteConnectionsQuery: () => ({
    data: connections,
    isLoading: false,
    error: undefined,
  }),
  useCreateRemoteConnectionMutation: () => [create, { isLoading: false }],
  useUpdateRemoteConnectionMutation: () => [update, { isLoading: false }],
  useDeleteRemoteConnectionMutation: () => [remove, { isLoading: false }],
  useTestRemoteConnectionMutation: () => [test, { isLoading: false }],
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** A DB-backed connection the ffmpeg executor uses, with a stored key. */
const ffmpeg = () => ({
  id: 'c1',
  name: 'ffmpeg',
  url: 'https://ffmpeg-worker-abc-uc.a.run.app',
  auth: 'google_id_token',
  hasCredential: true,
  maxInflight: 8,
  healthPath: '/health',
  source: {
    url: 'db',
    auth: 'db',
    credential: 'db',
    maxInflight: 'db',
    healthPath: 'db',
    envOnly: false,
  },
  envOnly: false,
  usedBy: { ffmpegExecutor: true, rules: 0 },
});

/** A DB row whose URL is pinned by REMOTE_CONNECTION_PDF_RENDERER_URL, auth none. */
const pdf = () => ({
  id: 'c2',
  name: 'pdf-renderer',
  url: 'http://pdf.internal:8080',
  auth: 'none',
  hasCredential: false,
  maxInflight: 4,
  healthPath: '/healthz',
  source: {
    url: 'env',
    auth: 'db',
    credential: null,
    maxInflight: 'db',
    healthPath: 'db',
    envOnly: false,
  },
  envOnly: false,
  usedBy: { ffmpegExecutor: false, rules: 2 },
});

/** Env-only: no DB row, so nothing to edit or delete. */
const legacy = () => ({
  id: null,
  name: 'legacy',
  url: 'https://legacy.example.com',
  auth: 'google_id_token',
  hasCredential: false,
  maxInflight: 8,
  healthPath: '/health',
  source: {
    url: 'env',
    auth: 'env',
    credential: null,
    maxInflight: 'env',
    healthPath: 'env',
    envOnly: true,
  },
  envOnly: true,
  usedBy: { ffmpegExecutor: false, rules: 0 },
});

beforeEach(() => {
  create.mockClear();
  update.mockClear();
  remove.mockClear();
  test.mockClear();
  testResult = { ok: true, status: 200, latencyMs: 42, version: '1.2.3', credential: 'adc' };
  connections = [ffmpeg(), pdf(), legacy()];
});

const row = (name: string) => screen.getByTestId(`connection-row-${name}`);
const openEdit = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));
  return screen.getByRole('dialog');
};
const openAdd = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  return screen.getByRole('dialog');
};

describe('RemoteConnectionsSettings', () => {
  it('renders one row per connection with host, auth, credential, env and usage chips', () => {
    render(<RemoteConnectionsSettings />);

    const ffmpegRow = row('ffmpeg');
    expect(within(ffmpegRow).getByText('ffmpeg')).toBeInTheDocument();
    expect(within(ffmpegRow).getByText('ffmpeg-worker-abc-uc.a.run.app')).toBeInTheDocument();
    expect(within(ffmpegRow).getByText('Google ID token')).toBeInTheDocument();
    expect(within(ffmpegRow).getByText('Key stored')).toBeInTheDocument();
    expect(within(ffmpegRow).getByText(/ffmpeg executor/)).toBeInTheDocument();

    const pdfRow = row('pdf-renderer');
    expect(within(pdfRow).getByText('None')).toBeInTheDocument();
    expect(within(pdfRow).getByText('—')).toBeInTheDocument();
    expect(within(pdfRow).getByText(/2 rules/)).toBeInTheDocument();

    const legacyRow = row('legacy');
    expect(within(legacyRow).getByText('Env')).toBeInTheDocument();
    // google_id_token with no stored key = Application Default Credentials.
    expect(within(legacyRow).getByText('ADC')).toBeInTheDocument();
  });

  it('Add connection: an invalid name blocks Save, a valid draft creates the connection', async () => {
    render(<RemoteConnectionsSettings />);
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'My_Bad' } });
    expect(within(dialog).getByText(/lower-case letters, digits and dashes/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'pdf-renderer' } });
    fireEvent.change(within(dialog).getByLabelText(/^URL/), {
      target: { value: 'https://pdf.run.app' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'pdf-renderer',
        url: 'https://pdf.run.app',
        auth: 'google_id_token',
        maxInflight: 8,
        healthPath: '/health',
      }),
    );
  });

  it('write-only credential: Remove sends null, a pasted key sends the string, untouched sends nothing', async () => {
    render(<RemoteConnectionsSettings />);

    // Remove → credential: null
    let dialog = openEdit('ffmpeg');
    expect(within(dialog).getByRole('button', { name: 'Replace key' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove key' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: 'c1', body: { credential: null } }),
    );

    // Replace → credential: the pasted string
    update.mockClear();
    dialog = openEdit('ffmpeg');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace key' }));
    fireEvent.change(within(dialog).getByLabelText(/Service-account key/), {
      target: { value: '{"type":"service_account"}' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: 'c1',
        body: { credential: '{"type":"service_account"}' },
      }),
    );

    // Untouched credential → no credential key at all
    update.mockClear();
    dialog = openEdit('ffmpeg');
    fireEvent.change(within(dialog).getByLabelText(/Max in-flight/), { target: { value: '16' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 'c1', body: { maxInflight: 16 } }));
  });

  it('auth none shows the destructive no-authentication alert', () => {
    render(<RemoteConnectionsSettings />);
    const dialog = openEdit('pdf-renderer');
    expect(within(dialog).getByText(/No authentication/)).toBeInTheDocument();
  });

  it('env-pinned fields are read-only, and an env-only connection can only be tested', () => {
    render(<RemoteConnectionsSettings />);
    const dialog = openEdit('pdf-renderer');
    expect(within(dialog).getByLabelText(/^URL/)).toBeDisabled();
    expect(
      within(dialog).getByText(/Managed by REMOTE_CONNECTION_PDF_RENDERER_URL/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const legacyRow = row('legacy');
    expect(within(legacyRow).queryByRole('button', { name: 'Edit legacy' })).not.toBeInTheDocument();
    expect(
      within(legacyRow).queryByRole('button', { name: 'Delete legacy' }),
    ).not.toBeInTheDocument();
    expect(within(legacyRow).getByRole('button', { name: 'Test legacy' })).toBeInTheDocument();
  });

  it('Delete confirms first, and is blocked while the ffmpeg executor uses the connection', async () => {
    // happy-dom does not implement window.confirm, so install one to spy on.
    const confirm = vi.fn(() => true);
    const original = window.confirm;
    window.confirm = confirm;
    render(<RemoteConnectionsSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete pdf-renderer' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 'c2' }));

    const blocked = screen.getByRole('button', { name: 'Delete ffmpeg' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute('title', 'In use by the ffmpeg Remote executor');
    window.confirm = original;
  });

  it('Test connection sends the draft and renders the result, or the error', async () => {
    render(<RemoteConnectionsSettings />);
    const dialog = openEdit('ffmpeg');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    await waitFor(() =>
      expect(test).toHaveBeenCalledWith({
        id: 'c1',
        url: 'https://ffmpeg-worker-abc-uc.a.run.app',
        auth: 'google_id_token',
        healthPath: '/health',
      }),
    );
    expect(await within(dialog).findByText('200 · 42 ms · v1.2.3')).toBeInTheDocument();

    testResult = {
      ok: false,
      status: null,
      latencyMs: null,
      error: 'connect ECONNREFUSED',
      credential: 'adc',
    };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    expect(await within(dialog).findByText('connect ECONNREFUSED')).toBeInTheDocument();
  });
});
