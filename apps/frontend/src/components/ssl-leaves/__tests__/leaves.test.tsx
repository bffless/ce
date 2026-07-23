import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServingChoiceCards } from '../ServingChoiceCards';
import { PasteCertificateFields } from '../PasteCertificateFields';
import { Port80Choice } from '../Port80Choice';
import { RealIpFields } from '../RealIpFields';

describe('ssl leaves', () => {
  it('ServingChoiceCards fires onChange with the picked mode', () => {
    const onChange = vi.fn();
    render(<ServingChoiceCards value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /cloudflare/i }));
    expect(onChange).toHaveBeenCalledWith('cloudflare');
  });
  it('PasteCertificateFields reports typed cert + key', () => {
    const onChange = vi.fn();
    render(<PasteCertificateFields certificatePem="" privateKeyPem="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/certificate/i), { target: { value: 'CERT' } });
    expect(onChange).toHaveBeenCalledWith({ certificatePem: 'CERT', privateKeyPem: '' });
  });
  it('Port80Choice renders with value=closed and fires onChange(redirect) when the other option is picked', () => {
    const onChange = vi.fn();
    render(<Port80Choice value="closed" onChange={onChange} />);
    const closedRadio = screen.getByRole('radio', { name: /close port 80/i });
    const redirectRadio = screen.getByRole('radio', { name: /redirect to https/i });
    expect(closedRadio).toBeChecked();
    expect(redirectRadio).not.toBeChecked();
    fireEvent.click(redirectRadio);
    expect(onChange).toHaveBeenCalledWith('redirect');
  });
  it('RealIpFields fires onChange with the merged {header, ranges} value when typing in the header input', () => {
    const onChange = vi.fn();
    render(<RealIpFields header="" ranges="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/header carrying the visitor ip/i), {
      target: { value: 'X-Forwarded-For' },
    });
    expect(onChange).toHaveBeenCalledWith({ header: 'X-Forwarded-For', ranges: '' });
  });
});
