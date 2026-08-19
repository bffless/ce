import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SetupProgress } from '../SetupProgress';
import type { StepId } from '@/store/slices/setupSlice';

describe('SetupProgress', () => {
  it('renders labels for the bootstrap step list, including Domain & SSL and Apply', () => {
    // Bootstrap list with the claim step present (claimRequired + no url token).
    const steps: StepId[] = ['claim', 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply'];
    render(<SetupProgress steps={steps} currentStep={1} />);

    // These three are exactly what the old hardcoded header could never show.
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText('Domain & SSL')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
    // 'Complete' belongs only to the normal flow and must NOT appear here.
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('renders the normal step list labels', () => {
    const steps: StepId[] = ['admin', 'storage', 'cache', 'email', 'complete'];
    render(<SetupProgress steps={steps} currentStep={2} />);

    expect(screen.getByText('Admin Account')).toBeInTheDocument();
    // Cache was silently omitted by the previous hardcoded header; assert it
    // now appears so a regression back to the hardcoded array is caught.
    expect(screen.getByText('Cache')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByText('Domain & SSL')).not.toBeInTheDocument();
  });
});
