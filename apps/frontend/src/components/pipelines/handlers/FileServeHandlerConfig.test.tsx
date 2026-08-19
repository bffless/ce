import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileServeHandlerConfig } from './FileServeHandlerConfig';

// Controlled harness: mirrors how the real editor feeds config back in, so the
// mode toggle's behavior across the full onChange round-trip is exercised.
function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [config, setConfig] = useState<Record<string, unknown>>(initial);
  return (
    <FileServeHandlerConfig
      config={config}
      onChange={(c) => setConfig(c as Record<string, unknown>)}
    />
  );
}

describe('FileServeHandlerConfig', () => {
  it('defaults to sub-directory mode and edits subDir', async () => {
    const onChange = vi.fn();
    render(<FileServeHandlerConfig config={{}} onChange={onChange} />);

    const subDir = screen.getByPlaceholderText('e.g., images, documents');
    expect(subDir).toBeInTheDocument();

    await userEvent.type(subDir, 'x');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subDir: 'x' }));
  });

  it('renders key mode when a key is already set', () => {
    const onChange = vi.fn();
    render(
      <FileServeHandlerConfig config={{ key: 'content/abc-styles.css' }} onChange={onChange} />,
    );

    expect(screen.getByDisplayValue('content/abc-styles.css')).toBeInTheDocument();
    // The path-derived subDir input should not be shown in key mode.
    expect(screen.queryByPlaceholderText('e.g., images, documents')).not.toBeInTheDocument();
  });

  it('switching to key mode clears subDir so exactly one is sent', async () => {
    const onChange = vi.fn();
    render(<FileServeHandlerConfig config={{ subDir: 'content' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /key/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subDir: undefined }));
  });

  it('can switch key → sub-directory → key and back to the key field', async () => {
    render(<Harness initial={{ key: 'content/x.css' }} />);

    // Start in key mode.
    expect(screen.getByDisplayValue('content/x.css')).toBeInTheDocument();

    // Key → Sub-directory (clears the key).
    await userEvent.click(screen.getByRole('button', { name: /sub-directory/i }));
    expect(screen.getByPlaceholderText('e.g., images, documents')).toBeInTheDocument();

    // Sub-directory → Key: the key input must come back even though key is empty.
    await userEvent.click(screen.getByRole('button', { name: /^key$/i }));
    expect(
      screen.getByPlaceholderText('e.g., content/{{steps.resolve.serveKey}}'),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g., images, documents')).not.toBeInTheDocument();
  });
});
