import { useState, useCallback } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { XmlFeedParseConfig } from './XmlFeedParseConfig';

// Controlled harness mirroring how the real editor feeds config back in.
// IMPORTANT: onChange MUST be stable (useCallback) — the component lists
// onChange in its effect deps (like DataCreateConfig), and HandlerConfigWrapper
// supplies a memoized callback. An unstable inline onChange here would spin the
// effect forever. `sink` is a stable ref created per-test to capture the last
// emitted config for assertions.
function Harness({
  initial = {},
  sink,
}: {
  initial?: Record<string, unknown>;
  sink?: { current: Record<string, unknown> };
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(initial);
  const handleChange = useCallback(
    (c: Record<string, unknown>) => {
      setConfig(c);
      if (sink) sink.current = c;
    },
    [sink],
  );
  return <XmlFeedParseConfig config={config} onChange={handleChange} />;
}

describe('XmlFeedParseConfig', () => {
  it('defaults to URL mode and shows concurrency + timeout inputs', () => {
    render(<Harness initial={{ urls: 'steps.feeds.urls' }} />);

    expect(screen.getByDisplayValue('steps.feeds.urls')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('8')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('30000')).toBeInTheDocument();
  });

  it('switches to raw-XML mode, hiding the URL/concurrency inputs', async () => {
    render(<Harness initial={{ urls: 'steps.feeds.urls' }} />);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'xml');

    expect(screen.getByPlaceholderText('steps.download.body')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('8')).not.toBeInTheDocument();
  });

  it('starts in raw-XML mode when config only has xml', () => {
    render(<Harness initial={{ xml: 'steps.download.body' }} />);
    expect(screen.getByDisplayValue('steps.download.body')).toBeInTheDocument();
  });

  it('emits numeric concurrency only when set, and omits unset timeout', async () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={{ urls: 'u' }} sink={sink} />);

    await userEvent.type(screen.getByPlaceholderText('8'), '4');

    expect(sink.current.urls).toBe('u');
    expect(sink.current.concurrency).toBe(4);
    expect(sink.current).not.toHaveProperty('timeoutMs');
  });
});
