import { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export type TabType = 'code' | 'preview';

/**
 * Determines the default tab based on file type
 */
function getDefaultTab(filepath?: string): TabType {
  if (!filepath) return 'code';

  // Directory paths (with trailing slash) default to preview
  if (filepath.endsWith('/')) {
    return 'preview';
  }

  const extension = filepath.split('.').pop()?.toLowerCase();

  // HTML files default to preview
  if (extension === 'html' || extension === 'htm') {
    return 'preview';
  }

  // Image files default to preview
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  if (imageExtensions.includes(extension || '')) {
    return 'preview';
  }

  // Markdown files default to preview
  if (extension === 'md' || extension === 'mdx') {
    return 'preview';
  }

  // All other files default to code
  return 'code';
}

interface BrowserTabsProps {
  /** The file path to determine default tab */
  filepath?: string;
  /** Content for the Code tab */
  codeContent: ReactNode;
  /** Content for the Preview tab */
  previewContent: ReactNode;
  /** Callback when tab changes */
  onTabChange?: (tab: TabType) => void;
  /** Optional left-side actions (passed down to viewers) */
  leftActions?: ReactNode;
}

/**
 * Manages tab content switching based on URL search params.
 * The tab toggle UI is in the FileActions (bottom toolbar).
 */
export function BrowserTabs({
  filepath,
  codeContent,
  previewContent,
}: BrowserTabsProps) {
  const [searchParams] = useSearchParams();

  // Get current tab from URL or use default
  const urlTab = searchParams.get('tab');
  const currentTab = (urlTab === 'code' || urlTab === 'preview')
    ? urlTab
    : getDefaultTab(filepath);

  return (
    <div className="h-full flex flex-col">
      {/* Code tab content */}
      {currentTab === 'code' && (
        <div className="flex-1 min-h-0 flex flex-col">{codeContent}</div>
      )}

      {/* Preview tab content */}
      {currentTab === 'preview' && (
        <div className="flex-1 min-h-0 flex flex-col">{previewContent}</div>
      )}
    </div>
  );
}
