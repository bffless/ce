import { useEffect, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Code, Eye, History } from 'lucide-react';

export type TabType = 'code' | 'preview' | 'history';

interface BrowserTabsProps {
  /** The file path to determine default tab */
  filepath?: string;
  /** Content for the Code tab */
  codeContent: ReactNode;
  /** Content for the Preview tab */
  previewContent: ReactNode;
  /** Content for the History tab */
  historyContent: ReactNode;
  /** Callback when tab changes */
  onTabChange?: (tab: TabType) => void;
  /** Optional left-side actions to render before the tabs */
  leftActions?: ReactNode;
}

/**
 * Determines the default tab based on file type
 */
function getDefaultTab(filepath?: string): TabType {
  if (!filepath) return 'code';

  // Directory paths (with trailing slash) default to preview
  // These serve index.html and should show the rendered page
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

export function BrowserTabs({
  filepath,
  codeContent,
  previewContent,
  historyContent,
  onTabChange,
  leftActions,
}: BrowserTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Get current tab from URL or use default
  const currentTab = (searchParams.get('tab') as TabType) || getDefaultTab(filepath);

  // Handle tab change
  const handleTabChange = (value: string) => {
    const newTab = value as TabType;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', newTab);
    setSearchParams(newParams);
    onTabChange?.(newTab);
  };

  // Keyboard shortcuts: Alt+C (code), Alt+P (preview), Alt+H (history)
  // @TODO: this does not work on MAC OS.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'c':
            event.preventDefault();
            handleTabChange('code');
            break;
          case 'p':
            event.preventDefault();
            handleTabChange('preview');
            break;
          case 'h':
            event.preventDefault();
            handleTabChange('history');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchParams]);

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="h-full flex flex-col">
      <div className="flex items-center gap-2 border-b px-2">
        {leftActions}
        <TabsList className="w-fit border-0">
          <TabsTrigger value="code" className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            <span>Code</span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-1">Alt+C</span>
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            <span>Preview</span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-1">Alt+P</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span>History</span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-1">Alt+H</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="code"
        className="flex-1 mt-0 overflow-hidden data-[state=active]:flex flex-col"
      >
        {codeContent}
      </TabsContent>

      <TabsContent
        value="preview"
        className="flex-1 mt-0 overflow-hidden data-[state=active]:flex flex-col"
      >
        {previewContent}
      </TabsContent>

      <TabsContent
        value="history"
        className="flex-1 mt-0 overflow-hidden data-[state=active]:flex flex-col"
      >
        {historyContent}
      </TabsContent>
    </Tabs>
  );
}
