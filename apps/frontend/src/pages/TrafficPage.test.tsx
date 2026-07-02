import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TrafficPage, isSignalEvent, type TrafficStreamEvent } from './TrafficPage';

// Radix Switch doesn't play well with happy-dom; stub it like other page tests do
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, id }: any) => (
    <input
      type="checkbox"
      id={id}
      role="switch"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}));

type Listener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

const makeEvent = (overrides: Partial<TrafficStreamEvent>): TrafficStreamEvent => ({
  id: Math.random().toString(36).slice(2),
  timestamp: '2026-07-02T09:05:03.000Z',
  ip: '203.0.113.7',
  method: 'GET',
  path: '/index.html',
  httpVersion: '1.1',
  status: 200,
  bytes: 512,
  referer: null,
  userAgent: 'test',
  host: 'j5s.dev',
  classification: 'matched',
  line: '203.0.113.7 - - [02/Jul/2026:09:05:03 +0000] "GET /index.html HTTP/1.1" 200 512 "-" "test"',
  ...overrides,
});

describe('isSignalEvent', () => {
  it('keeps unmatched requests', () => {
    expect(isSignalEvent(makeEvent({ classification: 'unmatched', status: 404 }))).toBe(true);
  });

  it('keeps 4xx/5xx responses even when matched', () => {
    expect(isSignalEvent(makeEvent({ status: 403 }))).toBe(true);
    expect(isSignalEvent(makeEvent({ status: 502 }))).toBe(true);
  });

  it('drops matched 2xx/3xx traffic', () => {
    expect(isSignalEvent(makeEvent({ status: 200 }))).toBe(false);
    expect(isSignalEvent(makeEvent({ status: 304 }))).toBe(false);
  });
});

describe('TrafficPage', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  const source = () => MockEventSource.instances[0];

  it('opens a credentialed SSE connection to the traffic stream', () => {
    render(<TrafficPage />);
    expect(source().url).toContain('/api/traffic/stream');
    expect(source().withCredentials).toBe(true);
  });

  it('defaults to showing only Unmatched and 4xx/5xx requests', () => {
    render(<TrafficPage />);
    act(() => {
      source().emit('request', makeEvent({ line: 'MATCHED-OK-LINE', status: 200 }));
      source().emit(
        'request',
        makeEvent({ line: 'SCANNER-LINE', status: 404, classification: 'unmatched', path: '/.env' }),
      );
    });

    expect(screen.getByText(/SCANNER-LINE/)).toBeInTheDocument();
    expect(screen.queryByText(/MATCHED-OK-LINE/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 matched request hidden/)).toBeInTheDocument();
  });

  it('reveals all traffic when "Show all" is toggled', () => {
    render(<TrafficPage />);
    act(() => {
      source().emit('request', makeEvent({ line: 'MATCHED-OK-LINE', status: 200 }));
    });
    expect(screen.queryByText(/MATCHED-OK-LINE/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText(/MATCHED-OK-LINE/)).toBeInTheDocument();
  });

  it('stops appending while paused and closes the stream on unmount', () => {
    const { unmount } = render(<TrafficPage />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    act(() => {
      source().emit('request', makeEvent({ line: 'WHILE-PAUSED', status: 404, classification: 'unmatched' }));
    });
    expect(screen.queryByText(/WHILE-PAUSED/)).not.toBeInTheDocument();

    unmount();
    expect(source().closed).toBe(true);
  });
});
