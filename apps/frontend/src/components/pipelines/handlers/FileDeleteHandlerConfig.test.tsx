import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileDeleteHandlerConfig } from './FileDeleteHandlerConfig';

// Controlled harness: mirrors how the real editor feeds config back in, so the
// mode toggle's behavior across the full onChange round-trip is exercised.
// `onConfig` observes every emitted config so tests can assert its shape.
function Harness({
  initial = {},
  onConfig,
}: {
  initial?: Record<string, unknown>;
  onConfig?: (config: Record<string, unknown>) => void;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(initial);
  return (
    <FileDeleteHandlerConfig
      config={config}
      onChange={(c) => {
        setConfig(c as Record<string, unknown>);
        onConfig?.(c as Record<string, unknown>);
      }}
    />
  );
}

const PREFIX_PLACEHOLDER = 'e.g., projects/{{request.body.projectId}}/';
const KEY_PLACEHOLDER = 'e.g., projects/abc123/source/uuid-file.mov';
const PREFIXES_EXPR_PLACEHOLDER = 'e.g., steps.cutoff.prefixes';

describe('FileDeleteHandlerConfig', () => {
  it('can switch key → prefix → key and back to the key field', async () => {
    render(<Harness initial={{ key: 'projects/abc/file.mov' }} />);

    expect(screen.getByDisplayValue('projects/abc/file.mov')).toBeInTheDocument();

    // Key → Prefix (clears the key).
    await userEvent.click(screen.getByRole('button', { name: /prefix \(folder\)/i }));
    expect(screen.getByPlaceholderText(PREFIX_PLACEHOLDER)).toBeInTheDocument();

    // Prefix → Key: the key input must come back even though key is empty.
    await userEvent.click(screen.getByRole('button', { name: /single key/i }));
    expect(screen.getByPlaceholderText(KEY_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(PREFIX_PLACEHOLDER)).not.toBeInTheDocument();
  });

  describe('prefixes mode', () => {
    it('emits a string[] from the static list (one prefix per line) and clears the other modes', async () => {
      const onConfig = vi.fn();
      render(<Harness initial={{ prefix: 'projects/abc/' }} onConfig={onConfig} />);

      await userEvent.click(screen.getByRole('button', { name: /prefixes \(list\)/i }));
      // Switching mode drops `prefix` so exactly one mode is sent.
      expect(onConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ prefix: undefined, key: undefined, prefixes: [] }),
      );

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'runs/a/{enter}{enter}  runs/b/  {enter}');

      const last = onConfig.mock.calls.at(-1)?.[0];
      // Blank lines are dropped and entries trimmed; the value is a real array.
      expect(last.prefixes).toEqual(['runs/a/', 'runs/b/']);
      expect(last.prefix).toBeUndefined();
    });

    it('emits a single expression string in the Expression form', async () => {
      const onConfig = vi.fn();
      render(<Harness onConfig={onConfig} />);

      await userEvent.click(screen.getByRole('button', { name: /prefixes \(list\)/i }));
      await userEvent.click(screen.getByRole('button', { name: /^expression$/i }));

      const input = screen.getByPlaceholderText(PREFIXES_EXPR_PLACEHOLDER);
      await userEvent.type(input, 'steps.cutoff.prefixes');

      const last = onConfig.mock.calls.at(-1)?.[0];
      expect(last.prefixes).toBe('steps.cutoff.prefixes');
    });

    it('seeds the static list from an existing prefixes array', () => {
      render(<Harness initial={{ prefixes: ['runs/a/', 'runs/b/'] }} />);

      expect(screen.getByRole('textbox')).toHaveValue('runs/a/\nruns/b/');
      expect(screen.queryByPlaceholderText(PREFIX_PLACEHOLDER)).not.toBeInTheDocument();
    });

    it('seeds the Expression form from an existing prefixes expression string', () => {
      render(<Harness initial={{ prefixes: 'steps.cutoff.prefixes' }} />);

      expect(screen.getByPlaceholderText(PREFIXES_EXPR_PLACEHOLDER)).toHaveValue(
        'steps.cutoff.prefixes',
      );
    });

    it('switching back to prefix mode drops prefixes', async () => {
      const onConfig = vi.fn();
      render(<Harness initial={{ prefixes: ['runs/a/'] }} onConfig={onConfig} />);

      await userEvent.click(screen.getByRole('button', { name: /prefix \(folder\)/i }));

      expect(onConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ prefixes: undefined, key: undefined }),
      );
      expect(screen.getByPlaceholderText(PREFIX_PLACEHOLDER)).toBeInTheDocument();
    });
  });
});
