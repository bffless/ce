import { useState, useCallback } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FfmpegHandlerConfig } from './FfmpegHandlerConfig';
import type { FfmpegHandlerConfig as Config } from './types';

/**
 * Controlled harness mirroring how the real editor feeds config back in, so the
 * block-presence semantics are exercised across the whole onChange round-trip.
 * `onChange` is memoized because the component lists it in a mount effect's
 * deps, exactly as HandlerConfigWrapper supplies it.
 */
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
  return <FfmpegHandlerConfig config={config} onChange={handleChange} />;
}

const FRAMES: Partial<Config> = {
  operation: 'frames',
  input: 'studio/source.mp4',
  outputPrefix: 'studio/stills',
};

const DRAW_TEXT = 'Chapter one, steps.plan.titles, or ["metadata.json"]';
const PER_SHEET = 'leave blank to upload each still';
const TIMES = '[1.5, 30, 92] or steps.pick.times';

describe('FfmpegHandlerConfig draw block', () => {
  it('writing text creates the draw block', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={FRAMES} sink={sink} />);

    fireEvent.change(screen.getByPlaceholderText(DRAW_TEXT), {
      target: { value: 'Chapter one' },
    });

    expect(sink.current.draw).toEqual({ text: 'Chapter one' });
  });

  it('clearing the text removes the whole draw block, not just the text', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(
      <Harness
        initial={{ ...FRAMES, draw: { text: 'Chapter one', position: 'center', color: 'red' } }}
        sink={sink}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(DRAW_TEXT), { target: { value: '' } });

    // `text` is the block's only required field, so an empty one cannot leave a
    // `draw` behind — the handler rejects a block without it.
    expect(sink.current.draw).toBeUndefined();
  });
});

describe('FfmpegHandlerConfig tile block', () => {
  it('filling in stills per sheet creates the tile block', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(<Harness initial={FRAMES} sink={sink} />);

    fireEvent.change(screen.getByPlaceholderText(PER_SHEET), { target: { value: '6' } });

    expect(sink.current.tile).toEqual({ perSheet: 6 });
  });

  it('columns cannot be set until tile exists', () => {
    render(<Harness initial={FRAMES} />);

    // Two number inputs share the placeholder "3" — JPEG quality, then Columns,
    // in that DOM order. Columns is the tile block's optional half, so it stays
    // disabled until `perSheet` has brought the block into existence.
    const threes = screen.getAllByPlaceholderText('3');
    expect(threes).toHaveLength(2);
    expect(threes[1]).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(PER_SHEET), { target: { value: '6' } });
    expect(screen.getAllByPlaceholderText('3')[1]).toBeEnabled();
  });
});

describe('FfmpegHandlerConfig output legend', () => {
  it('lists frames[] without tile and sheets[] with it', () => {
    // Keyed so the second render REMOUNTS: the harness seeds its state from
    // `initial` once, exactly as the real editor mounts a step's saved config.
    const { rerender } = render(<Harness key="plain" initial={FRAMES} />);

    // Scoped to the legend box: the tile hint above it names both shapes in
    // prose, so an unscoped query matches either way round.
    const legend = () =>
      screen.getByText('Step output (available to subsequent steps)').parentElement!;

    expect(within(legend()).getByText('frames')).toBeInTheDocument();
    expect(within(legend()).queryByText('sheets')).not.toBeInTheDocument();

    rerender(<Harness key="tiled" initial={{ ...FRAMES, tile: { perSheet: 6 } }} />);

    expect(within(legend()).getByText('sheets')).toBeInTheDocument();
    expect(within(legend()).queryByText('frames')).not.toBeInTheDocument();
  });
});

describe('FfmpegHandlerConfig operation switch', () => {
  it('frames → probe → frames strips the frames-only fields and rebuilds the form', () => {
    const sink = { current: {} as Record<string, unknown> };
    render(
      <Harness
        initial={{ ...FRAMES, times: '[1.5]', draw: { text: 'T' }, tile: { perSheet: 6 } }}
        sink={sink}
      />,
    );
    expect(screen.getByPlaceholderText(TIMES)).toBeInTheDocument();

    // The Operation select is the first combobox; `draw` adds a second (Position).
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByText('Probe / capability check'));

    expect(sink.current.operation).toBe('probe');
    expect(sink.current.times).toBeUndefined();
    expect(sink.current.draw).toBeUndefined();
    expect(sink.current.tile).toBeUndefined();
    expect(screen.queryByPlaceholderText(TIMES)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByText('Frames (stills, titled stills, contact sheets)'));

    expect(sink.current.operation).toBe('frames');
    // Rebuilt empty: the stripped fields must not come back from the old config.
    expect(screen.getByPlaceholderText(TIMES)).toHaveValue('');
    expect(screen.getByPlaceholderText(DRAW_TEXT)).toHaveValue('');
  });
});
