import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServingChoiceCards } from '../ServingChoiceCards';
import { PasteCertificateFields } from '../PasteCertificateFields';

describe('ssl leaves', () => {
  it('ServingChoiceCards fires onChange with the picked mode', () => {
    const onChange = vi.fn();
    render(<ServingChoiceCards value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(/Cloudflare/i));
    expect(onChange).toHaveBeenCalledWith('cloudflare');
  });
  it('PasteCertificateFields reports typed cert + key', () => {
    const onChange = vi.fn();
    render(<PasteCertificateFields certificatePem="" privateKeyPem="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/certificate/i), { target: { value: 'CERT' } });
    expect(onChange).toHaveBeenCalledWith({ certificatePem: 'CERT', privateKeyPem: '' });
  });
});
