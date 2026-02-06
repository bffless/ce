import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionBadge } from './PermissionBadge';

type PermissionLevel = 'owner' | 'admin' | 'contributor' | 'viewer';

// Render without tooltips to avoid TooltipProvider issues in tests
const renderBadge = (level: PermissionLevel, otherProps = {}) => {
  return render(<PermissionBadge level={level} showTooltip={false} {...otherProps} />);
};

describe('PermissionBadge', () => {
  describe('Permission levels', () => {
    it('renders owner badge with crown icon', () => {
      renderBadge('owner');
      expect(screen.getByText('Owner')).toBeInTheDocument();
    });

    it('renders admin badge with shield icon', () => {
      renderBadge('admin');
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('renders contributor badge with edit icon', () => {
      renderBadge('contributor');
      expect(screen.getByText('Contributor')).toBeInTheDocument();
    });

    it('renders viewer badge with eye icon', () => {
      renderBadge('viewer');
      expect(screen.getByText('Viewer')).toBeInTheDocument();
    });
  });

  describe('Size variants', () => {
    it('renders small badge when size=sm', () => {
      const { container } = renderBadge('owner', { size: 'sm' });
      const badge = container.querySelector('.text-xs.px-1\\.5');
      expect(badge).toBeInTheDocument();
    });

    it('renders medium badge when size=md', () => {
      const { container } = renderBadge('owner', { size: 'md' });
      const badge = container.querySelector('.text-xs.px-2\\.5');
      expect(badge).toBeInTheDocument();
    });

    it('defaults to medium size when size is not specified', () => {
      const { container } = renderBadge('owner');
      const badge = container.querySelector('.text-xs.px-2\\.5');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Icon-only mode', () => {
    it('shows only icon when iconOnly=true', () => {
      renderBadge('owner', { iconOnly: true });
      expect(screen.queryByText('Owner')).not.toBeInTheDocument();
    });

    it('shows label and icon when iconOnly=false', () => {
      renderBadge('owner', { iconOnly: false });
      expect(screen.getByText('Owner')).toBeInTheDocument();
    });

    it('defaults to showing label and icon', () => {
      renderBadge('owner');
      expect(screen.getByText('Owner')).toBeInTheDocument();
    });
  });

  describe('Tooltips disabled in tests', () => {
    it('renders without tooltip when showTooltip=false', () => {
      renderBadge('owner');
      const badge = screen.getByText('Owner');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = renderBadge('owner', { className: 'custom-class' });
      const badge = container.querySelector('.custom-class');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Color coding', () => {
    it('applies green color for owner', () => {
      const { container } = renderBadge('owner');
      const badge = container.querySelector('.bg-green-500');
      expect(badge).toBeInTheDocument();
    });

    it('applies blue color for admin', () => {
      const { container } = renderBadge('admin');
      const badge = container.querySelector('.bg-blue-500');
      expect(badge).toBeInTheDocument();
    });

    it('applies purple color for contributor', () => {
      const { container } = renderBadge('contributor');
      const badge = container.querySelector('.bg-purple-500');
      expect(badge).toBeInTheDocument();
    });

    it('applies gray color for viewer', () => {
      const { container } = renderBadge('viewer');
      const badge = container.querySelector('.bg-gray-500');
      expect(badge).toBeInTheDocument();
    });
  });
});
