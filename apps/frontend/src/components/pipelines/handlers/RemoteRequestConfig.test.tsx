import { useState, useCallback } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoteRequestConfig } from './RemoteRequestConfig';
import type { RemoteRequestHandlerConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let connections: any;
let listLoading: boolean;

vi.mock('@/services/settingsApi', () => ({
  useListRemoteConnectionNamesQuery: () => ({ data: connections, isLoading: listLoading }),
}));

beforeEach(() => {
  connections = [
    { name: 'ffmpeg', auth: 'google_id_token' },
    { name: 'pdf', auth: 'none' },
  ];
  listLoading = false;
});

/**
 * Controlled harness mirroring how the real editor feeds config back in.
 * onChange MUST be stable (useCallback): the component lists it in its effect
 * deps, and HandlerConfigWrapper supplies a memoized callback.
 */
function Harness({
  initial = {},
  sink,
}: {
  initial?: Partial<RemoteRequestHandlerConfig>;
  sink?: { current: Record<string, unknown> };
}) {
  const [config, setConfig] = useState<Partial<RemoteRequestHandlerConfig>>(initial);
  const handleChange = useCallback(
    (c: RemoteRequestHandlerConfig) => {
      setConfig(c);
      if (sink) sink.current = c as unknown as Record<string, unknown>;
    },
    [sink],
  );
  return <RemoteRequestConfig config={config} onChange={handleChange} />;
}

const connectionPicker = () => screen.getByRole('combobox', { name: /connection/i });

describe('RemoteRequestConfig', () => {
  it('lists the configured connections and flags an unauthenticated one', () => {
    render(<Harness />);
    fireEvent.click(connectionPicker());
    expect(screen.getByRole('option', { name: /^ffmpeg/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^pdf/ })).toBeInTheDocument();
    // `pdf` has auth 'none' — the step author should see that before picking it.
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('emits the picked connection, path and body', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness sink={sink} />);

    fireEvent.click(connectionPicker());
    fireEvent.click(screen.getByRole('option', { name: /^pdf/ }));
    fireEvent.change(screen.getByPlaceholderText('/render'), { target: { value: '/render' } });
    fireEvent.change(screen.getByPlaceholderText('steps.validate'), {
      target: { value: 'request.body' },
    });

    expect(sink.current).toEqual({
      connection: 'pdf',
      path: '/render',
      method: 'POST',
      body: 'request.body',
      failOnError: true,
      timeoutSeconds: 300,
    });
  });

  it('drops the body on GET', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ connection: 'pdf', body: 'request.body' }} sink={sink} />);

    fireEvent.click(screen.getByRole('combobox', { name: /method/i }));
    fireEvent.click(screen.getByRole('option', { name: 'GET' }));

    expect(sink.current.method).toBe('GET');
    expect(sink.current).not.toHaveProperty('body');
  });

  it('tells the author where connections come from when there are none', () => {
    connections = [];
    render(<Harness />);
    expect(
      screen.getByText(
        /No remote connections configured — an admin adds them under Settings → Infrastructure/,
      ),
    ).toBeInTheDocument();
  });

  it('does not claim there are no connections while the list is still loading', () => {
    connections = undefined;
    listLoading = true;
    render(<Harness />);
    expect(screen.queryByText(/No remote connections configured/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /connection/i })).not.toBeInTheDocument();
  });

  it('clamps the timeout to 1..3600 seconds', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ connection: 'pdf' }} sink={sink} />);
    const timeout = screen.getByLabelText(/Timeout/);

    fireEvent.change(timeout, { target: { value: '99999' } });
    expect(sink.current.timeoutSeconds).toBe(3600);

    fireEvent.change(timeout, { target: { value: '0' } });
    expect(sink.current.timeoutSeconds).toBe(1);
  });

  it('turning off failOnError is emitted', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ connection: 'pdf' }} sink={sink} />);
    fireEvent.click(screen.getByRole('switch', { name: /Fail on non-2xx/ }));
    expect(sink.current.failOnError).toBe(false);
  });

  it('keeps a condition it did not author (rules-as-code writes one, this editor has no field)', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ connection: 'pdf', condition: 'request.query.go' }} sink={sink} />);
    expect(sink.current.condition).toBe('request.query.go');

    fireEvent.change(screen.getByPlaceholderText('/render'), { target: { value: '/go' } });
    expect(sink.current).toMatchObject({ path: '/go', condition: 'request.query.go' });
  });

  it('drops an Authorization header and says why', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ connection: 'pdf' }} sink={sink} />);

    fireEvent.click(screen.getByRole('button', { name: /Add Header/ }));
    fireEvent.change(screen.getByPlaceholderText('Header-Name'), {
      target: { value: 'Authorization' },
    });

    expect(sink.current).not.toHaveProperty('headers');
    expect(screen.getByText(/the connection supplies the identity/i)).toBeInTheDocument();
  });

  it('round-trips a stored config without the author touching anything', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(
      <Harness
        initial={{
          connection: 'ffmpeg',
          path: '/probe',
          method: 'PUT',
          headers: { 'X-Trace': 'request.id' },
          timeoutSeconds: 60,
          failOnError: false,
        }}
        sink={sink}
      />,
    );
    expect(sink.current).toEqual({
      connection: 'ffmpeg',
      path: '/probe',
      method: 'PUT',
      headers: { 'X-Trace': 'request.id' },
      timeoutSeconds: 60,
      failOnError: false,
    });
  });
});
