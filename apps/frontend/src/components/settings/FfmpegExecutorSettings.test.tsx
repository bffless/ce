import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FfmpegExecutorSettings } from './FfmpegExecutorSettings';

const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const testConnection = vi.fn(() => ({
  unwrap: () =>
    Promise.resolve({
      ok: true,
      latencyMs: 42,
      worker: { version: '0.4.31', ffmpeg: 'ffmpeg version 6.1.1', ops: ['probe', 'slice'], uptimeS: 3 },
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

beforeEach(() => {
  update.mockClear();
  testConnection.mockClear();
  status = {
    localAvailable: true,
    localVersion: 'ffmpeg version 6.1.1',
    localEnabled: true,
    remoteEnabled: false,
    remoteUrl: null,
    remoteAuth: 'google_id_token',
    hasSaKey: false,
    saKeySource: null,
    defaultExecutor: 'local',
    storagePresignable: true,
    envManaged: { defaultExecutor: false, remoteUrl: false, remoteAuth: false, saKey: false },
  };
});

describe('FfmpegExecutorSettings', () => {
  it('shows the local version and disables the remote radio until Remote has a URL', () => {
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/ffmpeg version 6\.1\.1/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /remote/i })).toBeDisabled();
  });

  it('shows the red banner for auth none', () => {
    status.remoteEnabled = true;
    status.remoteUrl = 'http://ffmpeg-worker:8080';
    status.remoteAuth = 'none';
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/No authentication/)).toBeInTheDocument();
  });

  it('env-managed URL is read-only with a badge', () => {
    status.remoteEnabled = true;
    status.remoteUrl = 'https://env.example.com';
    status.envManaged.remoteUrl = true;
    render(<FfmpegExecutorSettings />);
    expect(screen.getByLabelText(/Worker URL/)).toBeDisabled();
    expect(screen.getByText(/Managed by FFMPEG_REMOTE_URL/)).toBeInTheDocument();
  });

  it('Test connection sends the draft and renders version, ops, latency and the ADC note', async () => {
    status.remoteEnabled = true;
    render(<FfmpegExecutorSettings />);
    fireEvent.change(screen.getByLabelText(/Worker URL/), {
      target: { value: 'https://draft.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    await waitFor(() =>
      expect(testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ remoteUrl: 'https://draft.example.com' }),
      ),
    );
    expect(await screen.findByText(/0\.4\.31/)).toBeInTheDocument();
    expect(screen.getByText(/42 ms/)).toBeInTheDocument();
    // "Application Default Credentials" also appears in the empty-key helper text,
    // so assert on the credential note's own wording.
    expect(screen.getByText(/Using Application Default Credentials/)).toBeInTheDocument();
  });

  it('Save sends only changed fields; a pasted key is sent as saKeyJson; stored key offers Replace/Remove', async () => {
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    fireEvent.change(screen.getByLabelText(/Worker URL/), { target: { value: 'https://w.example.com' } });
    fireEvent.change(screen.getByLabelText(/Service-account key/), {
      target: { value: '{"type":"service_account"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        remoteEnabled: true,
        remoteUrl: 'https://w.example.com',
        saKeyJson: '{"type":"service_account"}',
      }),
    );

    status.hasSaKey = true;
    status.saKeySource = 'db';
    status.remoteEnabled = true;
    status.remoteUrl = 'https://w.example.com';
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/Key stored/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace key/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove key/ })).toBeInTheDocument();
  });
});
