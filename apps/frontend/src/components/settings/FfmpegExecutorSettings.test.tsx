import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FfmpegExecutorSettings } from './FfmpegExecutorSettings';

const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const testConnection = vi.fn(() => ({
  unwrap: () =>
    Promise.resolve({
      ok: true,
      latencyMs: 42,
      worker: {
        version: '0.4.31',
        ffmpeg: 'ffmpeg version 6.1.1',
        ops: ['probe', 'slice'],
        uptimeS: 3,
      },
      readiness: { ok: true },
      credential: 'adc',
    }),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let status: any;

vi.mock('@/services/settingsApi', () => ({
  useGetFfmpegExecutorSettingsQuery: () => ({ data: status, isLoading: false, error: undefined }),
  useUpdateFfmpegExecutorSettingsMutation: () => [update, { isLoading: false }],
  useTestFfmpegExecutorConnectionMutation: () => [testConnection, { isLoading: false }],
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** The saved-connection block the status embeds when a connection is selected. */
const savedFfmpeg = {
  id: 'c1',
  name: 'ffmpeg',
  url: 'https://worker.example.com',
  auth: 'google_id_token',
  hasCredential: true,
  credentialSource: 'db',
  envOnly: false,
};

const connectionPicker = () => screen.getByRole('combobox', { name: /connection/i });

/** Radix Select: open the trigger, then click the option by its accessible name. */
const pickConnection = (name: string) => {
  fireEvent.click(connectionPicker());
  fireEvent.click(screen.getByRole('option', { name }));
};

beforeEach(() => {
  update.mockClear();
  testConnection.mockClear();
  status = {
    localAvailable: true,
    localVersion: 'ffmpeg version 6.1.1',
    localEnabled: true,
    remoteEnabled: false,
    remoteConnection: null,
    connections: [{ id: 'c1', name: 'ffmpeg', auth: 'google_id_token', envOnly: false }],
    defaultExecutor: 'local',
    storagePresignable: true,
    envManaged: { defaultExecutor: false, remoteConnection: false },
  };
});

describe('FfmpegExecutorSettings', () => {
  it('shows the local version and disables the remote radio until a connection is picked', () => {
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/ffmpeg version 6\.1\.1/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /remote/i })).toBeDisabled();
  });

  it('enabling Remote and picking a connection saves both fields', async () => {
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    pickConnection('ffmpeg');
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ remoteEnabled: true, remoteConnection: 'ffmpeg' }),
    );
  });

  it('Save is gated on a connection while Remote is on', () => {
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    // The server refuses this exact combination with "Remote executor needs a
    // connection", so the button must not offer the round trip.
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled();
    pickConnection('ffmpeg');
    expect(screen.getByRole('button', { name: /^Save/ })).not.toBeDisabled();
  });

  it('picking a connection makes Remote selectable as the default executor', () => {
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    expect(screen.getByRole('radio', { name: /remote/i })).toBeDisabled();
    pickConnection('ffmpeg');
    expect(screen.getByRole('radio', { name: /remote/i })).not.toBeDisabled();
  });

  it('shows the selected connection host, auth and credential', () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/worker\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Google ID token/)).toBeInTheDocument();
    expect(screen.getByText(/Key stored/)).toBeInTheDocument();
  });

  it('an env-managed connection is a disabled picker with a badge', () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    status.envManaged.remoteConnection = true;
    render(<FfmpegExecutorSettings />);
    expect(connectionPicker()).toBeDisabled();
    expect(
      screen.getByText(/Managed by FFMPEG_REMOTE_CONNECTION \/ FFMPEG_REMOTE_URL/),
    ).toBeInTheDocument();
    // The backend forces remoteEnabled on when the connection is env-pinned, so
    // the switch must be read-only rather than a toggle that snaps back.
    expect(screen.getByRole('switch', { name: /Remote/ })).toBeDisabled();
  });

  it('an env-only connection is offered but not selectable', () => {
    status.connections.push({ id: null, name: 'env-worker', auth: 'none', envOnly: true });
    status.remoteEnabled = true;
    render(<FfmpegExecutorSettings />);
    fireEvent.click(connectionPicker());
    expect(
      screen.getByRole('option', {
        name: /env-worker \(env — select with FFMPEG_REMOTE_CONNECTION\)/,
      }),
    ).toHaveAttribute('data-disabled');
  });

  it('Test connection sends the picked connection and renders the worker facts', async () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    await waitFor(() =>
      expect(testConnection).toHaveBeenCalledWith({ remoteConnection: 'ffmpeg' }),
    );
    expect(await screen.findByText(/Worker 0\.4\.31/)).toBeInTheDocument();
    expect(screen.getByText(/42 ms/)).toBeInTheDocument();
    expect(screen.getByText(/Using Application Default Credentials/)).toBeInTheDocument();
  });

  it('Test connection is disabled until a connection is picked', () => {
    status.remoteEnabled = true;
    render(<FfmpegExecutorSettings />);
    expect(screen.getByRole('button', { name: /Test connection/ })).toBeDisabled();
  });

  it('no connections at all: helper text, and the Remote switch still toggles', () => {
    status.connections = [];
    render(<FfmpegExecutorSettings />);
    const remote = screen.getByRole('switch', { name: /Remote/ });
    expect(remote).not.toBeDisabled();
    fireEvent.click(remote);
    expect(
      screen.getByText(/No remote connections yet — add one under Infrastructure/),
    ).toBeInTheDocument();
  });

  it('links to the Infrastructure tab where connections are managed', () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    render(<FfmpegExecutorSettings />);
    expect(
      screen.getByRole('link', { name: /Manage connections in Infrastructure/ }),
    ).toHaveAttribute('href', '/admin/settings/infrastructure');
  });

  it('local-filesystem storage makes Remote unavailable', () => {
    status.storagePresignable = false;
    render(<FfmpegExecutorSettings />);
    expect(screen.getByRole('switch', { name: /Remote/ })).toBeDisabled();
    expect(screen.getByText(/Needs bucket storage/)).toBeInTheDocument();
  });

  it('moves the default off an executor the draft just disabled', async () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    status.defaultExecutor = 'remote';
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ remoteEnabled: false, defaultExecutor: 'local' }),
    );
  });

  it('an env-pinned default executor never auto-moves', async () => {
    status.envManaged.defaultExecutor = true;
    status.defaultExecutor = 'remote';
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ remoteEnabled: false }));
  });

  it('changing the picked connection clears a stale test result', async () => {
    status.remoteEnabled = true;
    status.remoteConnection = savedFfmpeg;
    status.connections.push({ id: 'c2', name: 'other', auth: 'none', envOnly: false });
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    expect(await screen.findByText(/Worker 0\.4\.31/)).toBeInTheDocument();
    pickConnection('other');
    expect(screen.queryByText(/Worker 0\.4\.31/)).not.toBeInTheDocument();
  });
});
