import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonField } from './JsonField';

describe('JsonField', () => {
  it('applies a parsed object on blur and reports one that does not parse without applying it', () => {
    const onChange = vi.fn();
    render(<JsonField label="Schema" value={{ a: 1 }} onChange={onChange} />);
    const editor = screen.getByLabelText('Schema') as HTMLTextAreaElement;
    expect(editor.value).toContain('"a": 1');

    fireEvent.change(editor, { target: { value: '{"b":2}' } });
    fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ b: 2 });

    fireEvent.change(editor, { target: { value: '{"b":' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/);
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: '[1]' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toMatch(/must be a JSON object/);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('re-seeds the text when the value is replaced from outside', () => {
    const { rerender } = render(<JsonField label="Schema" value={{ a: 1 }} onChange={() => {}} />);
    rerender(<JsonField label="Schema" value={{ z: 9 }} onChange={() => {}} />);
    expect((screen.getByLabelText('Schema') as HTMLTextAreaElement).value).toContain('"z": 9');
  });
});
