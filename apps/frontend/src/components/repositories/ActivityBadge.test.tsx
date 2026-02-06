import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityBadge } from './ActivityBadge';

// Render without tooltips by default to avoid TooltipProvider issues in tests
const renderBadge = (lastDeployedAt: string | null, otherProps = {}) => {
  return render(<ActivityBadge lastDeployedAt={lastDeployedAt} showTooltip={false} {...otherProps} />);
};

describe('ActivityBadge', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock current date to 2025-12-10
    mockDate = new Date('2025-12-10T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Null handling', () => {
    it('returns null when lastDeployedAt is null', () => {
      const { container } = renderBadge(null);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Active state (< 7 days)', () => {
    it('shows active badge for deployment today', () => {
      const today = new Date('2025-12-10T10:00:00Z').toISOString();
      renderBadge(today);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows active badge for deployment 3 days ago', () => {
      const threeDaysAgo = new Date('2025-12-07T12:00:00Z').toISOString();
      renderBadge(threeDaysAgo);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows active badge for deployment 6 days ago', () => {
      const sixDaysAgo = new Date('2025-12-04T12:00:00Z').toISOString();
      renderBadge(sixDaysAgo);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('uses green indicator for active deployments', () => {
      const today = new Date('2025-12-10T10:00:00Z').toISOString();
      const { container } = renderBadge(today);
      const indicator = container.querySelector('.text-green-500');
      expect(indicator).toBeInTheDocument();
      expect(indicator?.textContent).toBe('●');
    });
  });

  describe('Inactive state (>= 7 days)', () => {
    it('shows inactive badge for deployment 7 days ago', () => {
      const sevenDaysAgo = new Date('2025-12-03T12:00:00Z').toISOString();
      renderBadge(sevenDaysAgo);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('shows inactive badge for deployment 30 days ago', () => {
      const thirtyDaysAgo = new Date('2025-11-10T12:00:00Z').toISOString();
      renderBadge(thirtyDaysAgo);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('shows inactive badge for deployment 365 days ago', () => {
      const oneYearAgo = new Date('2024-12-10T12:00:00Z').toISOString();
      renderBadge(oneYearAgo);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('uses gray indicator for inactive deployments', () => {
      const sevenDaysAgo = new Date('2025-12-03T12:00:00Z').toISOString();
      const { container } = renderBadge(sevenDaysAgo);
      const indicator = container.querySelector('.text-gray-500');
      expect(indicator).toBeInTheDocument();
      expect(indicator?.textContent).toBe('○');
    });
  });

  describe('Tooltip disabled in tests', () => {
    it('renders without tooltip when showTooltip=false', () => {
      const today = new Date('2025-12-10T10:00:00Z').toISOString();
      renderBadge(today);
      const badge = screen.getByText('Active');
      expect(badge).toBeInTheDocument();
      // Badge should be rendered without tooltip wrapper
    });
  });

  describe('Badge variants', () => {
    it('uses default variant for active deployments', () => {
      const today = new Date('2025-12-10T10:00:00Z').toISOString();
      const { container } = renderBadge(today);
      const badge = container.querySelector('.bg-primary');
      expect(badge).toBeInTheDocument();
    });

    it('uses secondary variant for inactive deployments', () => {
      const sevenDaysAgo = new Date('2025-12-03T12:00:00Z').toISOString();
      const { container } = renderBadge(sevenDaysAgo);
      const badge = container.querySelector('.bg-secondary');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const today = new Date('2025-12-10T10:00:00Z').toISOString();
      const { container } = renderBadge(today, { className: 'custom-class' });
      const badge = container.querySelector('.custom-class');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('handles deployment exactly at 7 day boundary', () => {
      const exactlySevenDaysAgo = new Date('2025-12-03T12:00:00Z').toISOString();
      renderBadge(exactlySevenDaysAgo);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('handles deployment just under 7 days', () => {
      const almostSevenDaysAgo = new Date('2025-12-03T13:00:00Z').toISOString();
      renderBadge(almostSevenDaysAgo);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('handles very recent deployment (minutes ago)', () => {
      const minutesAgo = new Date('2025-12-10T11:50:00Z').toISOString();
      renderBadge(minutesAgo);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('handles future date gracefully', () => {
      const futureDate = new Date('2025-12-15T12:00:00Z').toISOString();
      renderBadge(futureDate);
      // Should still render without crashing
      const badge = screen.queryByText(/Active|Inactive/i);
      expect(badge).toBeInTheDocument();
    });
  });
});
