import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileDeleteHandlerConfig } from './FileDeleteHandlerConfig';

// Controlled harness: mirrors how the real editor feeds config back in, so the
// mode toggle's behavior across the full onChange round-trip is exercised.
function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [config, setConfig] = useState<Record<string, unknown>>(initial);
  return (
    <FileDeleteHandlerConfig
      config={config}
      onChange={(c) => setConfig(c as Record<string, unknown>)}
    />
  );
}

describe('FileDeleteHandlerConfig', () => {
  it('can switch key → prefix → key and back to the key field', async () => {
    render(<Harness initial={{ key: 'projects/abc/file.mov' }} />);

    expect(screen.getByDisplayValue('projects/abc/file.mov')).toBeInTheDocument();

    // Key → Prefix (clears the key).
    await userEvent.click(screen.getByRole('button', { name: /prefix/i }));
    expect(
      screen.getByPlaceholderText('e.g., projects/{{request.body.projectId}}/'),
    ).toBeInTheDocument();

    // Prefix → Key: the key input must come back even though key is empty.
    await userEvent.click(screen.getByRole('button', { name: /single key/i }));
    expect(
      screen.getByPlaceholderText('e.g., projects/abc123/source/uuid-file.mov'),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('e.g., projects/{{request.body.projectId}}/'),
    ).not.toBeInTheDocument();
  });
});
