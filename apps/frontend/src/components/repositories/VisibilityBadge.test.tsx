import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisibilityBadge } from './VisibilityBadge';

// Render without tooltips to avoid TooltipProvider issues in tests
const renderBadge = (isPublic: boolean, otherProps = {}) => {
  return render(<VisibilityBadge isPublic={isPublic} showTooltip={false} {...otherProps} />);
};

describe('VisibilityBadge', () => {
  describe('Public repositories', () => {
    it('renders public badge with globe icon', () => {
      renderBadge(true);
      expect(screen.getByText('Public')).toBeInTheDocument();
    });


    it('uses outline variant for public repositories', () => {
      const { container } = renderBadge(true);
      const badge = container.querySelector('.text-foreground');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Private repositories', () => {
    it('renders private badge with lock icon', () => {
      renderBadge(false);
      expect(screen.getByText('Private')).toBeInTheDocument();
    });


    it('uses secondary variant for private repositories', () => {
      const { container } = renderBadge(false);
      const badge = container.querySelector('.bg-secondary');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Size variants', () => {
    it('renders small badge when size=sm', () => {
      const { container } = renderBadge(true, { size: 'sm' });
      const badge = container.querySelector('.text-xs.px-1\\.5');
      expect(badge).toBeInTheDocument();
    });

    it('renders medium badge when size=md', () => {
      const { container } = renderBadge(true, { size: 'md' });
      const badge = container.querySelector('.text-xs.px-2\\.5');
      expect(badge).toBeInTheDocument();
    });

    it('defaults to medium size when size is not specified', () => {
      const { container } = renderBadge(true);
      const badge = container.querySelector('.text-xs.px-2\\.5');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Tooltips disabled in tests', () => {
    it('renders without tooltip when showTooltip=false', () => {
      renderBadge(true);
      const badge = screen.getByText('Public');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = renderBadge(true, { className: 'custom-class' });
      const badge = container.querySelector('.custom-class');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('includes both icon and text for screen readers', () => {
      renderBadge(true);
      expect(screen.getByText('Public')).toBeInTheDocument();
    });

    it('includes both icon and text for private badge', () => {
      renderBadge(false);
      expect(screen.getByText('Private')).toBeInTheDocument();
    });
  });
});
