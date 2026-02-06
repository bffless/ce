import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorageIndicator } from './StorageIndicator';

// Render without tooltips to avoid TooltipProvider issues in tests
const renderBadge = (storageBytes: number, otherProps = {}) => {
  return render(<StorageIndicator storageBytes={storageBytes} showTooltip={false} {...otherProps} />);
};

describe('StorageIndicator', () => {
  describe('Storage formatting', () => {
    it('displays storage size in human-readable format for bytes', () => {
      renderBadge(512);
      expect(screen.getByText('512.0 B')).toBeInTheDocument();
    });

    it('displays storage size in KB', () => {
      renderBadge(1024 * 50);
      expect(screen.getByText('50.0 KB')).toBeInTheDocument();
    });

    it('displays storage size in MB', () => {
      renderBadge(1024 * 1024 * 5);
      expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    });

    it('displays storage size in GB', () => {
      renderBadge(1024 * 1024 * 1024 * 2);
      expect(screen.getByText('2.0 GB')).toBeInTheDocument();
    });
  });

  describe('Color coding thresholds', () => {
    it('applies green color for storage < 100MB', () => {
      const { container } = renderBadge(50 * 1024 * 1024);
      const icon = container.querySelector('.text-green-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies yellow color for storage between 100MB and 500MB', () => {
      const { container } = renderBadge(250 * 1024 * 1024);
      const icon = container.querySelector('.text-yellow-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies red color for storage > 500MB', () => {
      const { container } = renderBadge(600 * 1024 * 1024);
      const icon = container.querySelector('.text-red-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies green color at 99.9MB threshold', () => {
      const { container } = renderBadge(99.9 * 1024 * 1024);
      const icon = container.querySelector('.text-green-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies yellow color at 100MB threshold', () => {
      const { container } = renderBadge(100 * 1024 * 1024);
      const icon = container.querySelector('.text-yellow-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies yellow color at 499MB threshold', () => {
      const { container } = renderBadge(499 * 1024 * 1024);
      const icon = container.querySelector('.text-yellow-600');
      expect(icon).toBeInTheDocument();
    });

    it('applies red color at 500MB threshold', () => {
      const { container } = renderBadge(500 * 1024 * 1024);
      const icon = container.querySelector('.text-red-600');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('Tooltip disabled in tests', () => {
    it('does not render info button when showTooltip=false', () => {
      renderBadge(100 * 1024 * 1024);
      const infoIcon = screen.queryByRole('button');
      expect(infoIcon).not.toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = renderBadge(1024, { className: 'custom-class' });
      const wrapper = container.querySelector('.custom-class');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Zero storage', () => {
    it('handles zero bytes correctly', () => {
      renderBadge(0);
      expect(screen.getByText('0 B')).toBeInTheDocument();
    });

    it('applies green color for zero storage', () => {
      const { container } = renderBadge(0);
      const icon = container.querySelector('.text-green-600');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('Icons', () => {
    it('renders hard drive icon', () => {
      const { container } = renderBadge(1024);
      const icon = container.querySelector('.h-4.w-4');
      expect(icon).toBeInTheDocument();
    });
  });
});
