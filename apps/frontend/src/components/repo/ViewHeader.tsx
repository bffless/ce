import { ReactNode } from 'react';

interface ViewHeaderProps {
  /** Title to display */
  title: string;
  /** Icon component to display before title */
  icon?: ReactNode;
  /** Optional left-side actions to render before the title (e.g., hamburger menu) */
  leftActions?: ReactNode;
  /** Optional right-side actions */
  rightActions?: ReactNode;
}

/**
 * Header component for views that don't have tabs (CommitOverview, DirectoryViewer)
 * Provides consistent styling and hamburger menu support when sidebar is closed
 */
export function ViewHeader({ title, icon, leftActions, rightActions }: ViewHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b px-2 py-2">
      {leftActions}
      <div className="flex items-center gap-2 flex-1">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {rightActions}
    </div>
  );
}
