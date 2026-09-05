import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StringListInput } from './StringListInput';

describe('StringListInput', () => {
  it('shows each value as a removable chip', () => {
    const onChange = vi.fn();
    render(
      <StringListInput label="Domains" value={['$app', 'https://x.test']} onChange={onChange} />,
    );
    expect(screen.getByText('$app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove $app' }));
    expect(onChange).toHaveBeenCalledWith(['https://x.test']);
  });

  it('adds a typed value on Enter and ignores blanks and duplicates', () => {
    const onChange = vi.fn();
    render(<StringListInput label="Domains" value={['a']} onChange={onChange} />);
    const input = screen.getByLabelText('Domains');
    fireEvent.change(input, { target: { value: ' b ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('offers suggestion chips that add on click', () => {
    const onChange = vi.fn();
    render(
      <StringListInput
        label="Domains"
        value={[]}
        onChange={onChange}
        suggestions={[{ value: '$app', hint: 'this origin' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add $app' }));
    expect(onChange).toHaveBeenCalledWith(['$app']);
  });
});
