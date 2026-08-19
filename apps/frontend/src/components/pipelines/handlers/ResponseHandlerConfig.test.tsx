import { useState, useCallback } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResponseHandlerConfig } from './ResponseHandlerConfig';
import type { ResponseHandlerConfig as Config } from './types';

// Radix Popover doesn't play well with happy-dom; render trigger + content flat.
// (Same workaround used by DomainBlocklistsSection.test.tsx.)
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

function Harness({
  initial = {},
  sink,
}: {
  initial?: Partial<Config>;
  sink?: { current: Record<string, unknown> };
}) {
  const [config, setConfig] = useState<Partial<Config>>(initial);
  const handleChange = useCallback(
    (c: Config) => {
      const record = c as unknown as Record<string, unknown>;
      setConfig(record);
      if (sink) sink.current = record;
    },
    [sink],
  );
  return <ResponseHandlerConfig config={config} onChange={handleChange} />;
}

describe('ResponseHandlerConfig status code', () => {
  it('shows a non-preset stored status instead of blanking it out', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ status: 503 }} sink={sink} />);

    expect(screen.getByRole('combobox', { name: /status code/i })).toHaveTextContent('503');
    // Untouched, so the emitted config must still carry the original value.
    expect(sink.current.status).toBe(503);
  });
});

describe('ResponseHandlerConfig content type', () => {
  it('defaults to application/json', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: /content type/i })).toHaveTextContent(
      'application/json',
    );
  });

  it('shows an unrecognized stored content type instead of blanking it out', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ contentType: 'application/rss+xml' }} sink={sink} />);

    expect(screen.getByRole('combobox', { name: /content type/i })).toHaveTextContent(
      'application/rss+xml',
    );
    // Untouched, so the emitted config must still carry the original value.
    expect(sink.current.contentType).toBe('application/rss+xml');
  });

  it('selecting a preset updates the emitted config', async () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness sink={sink} />);

    fireEvent.click(screen.getByRole('combobox', { name: /content type/i }));
    fireEvent.click(screen.getByText('HTML (text/html)'));

    expect(sink.current.contentType).toBe('text/html');
    expect(screen.getByRole('combobox', { name: /content type/i })).toHaveTextContent('text/html');
  });

  it('shows the full preset list on open even with a custom value stored, so it stays pickable', () => {
    render(<Harness initial={{ contentType: 'application/rss+xml' }} />);

    fireEvent.click(screen.getByRole('combobox', { name: /content type/i }));

    expect(screen.getByText('HTML (text/html)')).toBeInTheDocument();
    expect(screen.getByText('JSON (application/json)')).toBeInTheDocument();
  });

  it('typing a custom content type preserves it verbatim', async () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness sink={sink} />);

    fireEvent.click(screen.getByRole('combobox', { name: /content type/i }));
    const input = screen.getByPlaceholderText('Search or type a content type...');
    await userEvent.clear(input);
    await userEvent.type(input, 'application/vnd.custom+json');

    expect(sink.current.contentType).toBe('application/vnd.custom+json');
  });
});
