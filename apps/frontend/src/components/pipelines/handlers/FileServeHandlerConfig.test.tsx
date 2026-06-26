import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileServeHandlerConfig } from './FileServeHandlerConfig';

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
});
