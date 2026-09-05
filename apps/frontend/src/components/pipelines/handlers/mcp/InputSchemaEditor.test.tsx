import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputSchemaEditor } from './InputSchemaEditor';

const flat = {
  type: 'object',
  required: ['impl'],
  properties: { impl: { type: 'string', description: 'The alias' } },
  additionalProperties: false,
};

describe('InputSchemaEditor', () => {
  it('lists the properties of a flat schema and adds one', () => {
    const onChange = vi.fn();
    render(<InputSchemaEditor value={flat} onChange={onChange} />);
    expect(screen.getByDisplayValue('impl')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'impl required' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /add property/i }));
    const names = screen.getAllByPlaceholderText('name');
    fireEvent.change(names[1], { target: { value: 'limit' } });
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'object',
      required: ['impl'],
      properties: { impl: { type: 'string', description: 'The alias' }, limit: { type: 'string' } },
      additionalProperties: false,
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'limit required' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ required: ['impl', 'limit'] }),
    );
  });

  it('removes a property', () => {
    const onChange = vi.fn();
    render(<InputSchemaEditor value={flat} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove impl' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'object',
      required: [],
      properties: {},
      additionalProperties: false,
    });
  });

  it('toggles whether extra arguments are allowed', () => {
    const onChange = vi.fn();
    render(<InputSchemaEditor value={flat} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /allow extra arguments/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ additionalProperties: true }),
    );
  });

  it('falls back to JSON for a schema the builder cannot show', () => {
    const rich = { type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } } };
    render(<InputSchemaEditor value={rich} onChange={() => {}} />);
    expect(screen.getByText(/builder can.t show/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Input schema (JSON)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add property/i })).not.toBeInTheDocument();
  });

  it('can switch a flat schema to JSON and back', () => {
    render(<InputSchemaEditor value={flat} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit as json/i }));
    expect(screen.getByLabelText('Input schema (JSON)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit as table/i }));
    expect(screen.getByDisplayValue('impl')).toBeInTheDocument();
  });
});
