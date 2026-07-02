import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrafficPage, LiveTrafficTab, isSignalEvent, type TrafficStreamEvent } from './TrafficPage';

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

// The History/Rollup tabs have their own tests; stub them so TrafficPage tests
// don't need the RTK Query store.
vi.mock('@/components/traffic/TrafficHistoryTab', () => ({
  TrafficHistoryTab: () => <div>HISTORY-TAB-CONTENT</div>,
}));
vi.mock('@/components/traffic/TrafficRollupTab', () => ({
  TrafficRollupTab: () => <div>ROLLUP-TAB-CONTENT</div>,
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

describe('TrafficPage tabs', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    localStorage.clear();
  });

  it('shows the live tail by default and switches to History and By IP', () => {
    render(
      <MemoryRouter>
        <TrafficPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Live requests')).toBeInTheDocument();
    expect(screen.queryByText('HISTORY-TAB-CONTENT')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'History' }), { button: 0 });
    expect(screen.getByText('HISTORY-TAB-CONTENT')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'By IP' }), { button: 0 });
    expect(screen.getByText('ROLLUP-TAB-CONTENT')).toBeInTheDocument();
  });
});

describe('LiveTrafficTab', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    localStorage.clear();
  });

  const source = () => MockEventSource.instances[0];

  it('opens a credentialed SSE connection to the traffic stream', () => {
    render(<LiveTrafficTab />);
    expect(source().url).toContain('/api/traffic/stream');
    expect(source().withCredentials).toBe(true);
  });

  it('defaults to showing only Unmatched and 4xx/5xx requests', () => {
    render(<LiveTrafficTab />);
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
    render(<LiveTrafficTab />);
    act(() => {
      source().emit('request', makeEvent({ line: 'MATCHED-OK-LINE', status: 200 }));
    });
    expect(screen.queryByText(/MATCHED-OK-LINE/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/show all/i));
    expect(screen.getByText(/MATCHED-OK-LINE/)).toBeInTheDocument();
  });

  it('defaults to unwrapped lines and persists the wrap preference', () => {
    render(<LiveTrafficTab />);
    act(() => {
      source().emit('request', makeEvent({ line: 'SCANNER-LINE', status: 404, classification: 'unmatched' }));
    });

    const line = screen.getByText(/SCANNER-LINE/).parentElement!;
    expect(line.className).toContain('whitespace-pre');
    expect(line.className).not.toContain('whitespace-pre-wrap');

    fireEvent.click(screen.getByLabelText(/wrap lines/i));
    expect(screen.getByText(/SCANNER-LINE/).parentElement!.className).toContain(
      'whitespace-pre-wrap',
    );
    expect(localStorage.getItem('bffless.traffic.wrapLines')).toBe('true');
  });

  it('shows a Paused badge instead of Live while paused', () => {
    render(<LiveTrafficTab />);
    act(() => source().onopen?.());
    expect(screen.getByText('Live')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('stops appending while paused and closes the stream on unmount', () => {
    const { unmount } = render(<LiveTrafficTab />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    act(() => {
      source().emit('request', makeEvent({ line: 'WHILE-PAUSED', status: 404, classification: 'unmatched' }));
    });
    expect(screen.queryByText(/WHILE-PAUSED/)).not.toBeInTheDocument();

    unmount();
    expect(source().closed).toBe(true);
  });
});
