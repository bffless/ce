import { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tag, GitBranch, GitCommit } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RefSelectorTab } from '@/store/slices/refSelectorSlice';

interface RefSelectorTabsProps {
  activeTab: RefSelectorTab;
  onTabChange: (tab: RefSelectorTab) => void;
  aliasCount: number;
  branchCount: number;
  commitCount: number;
  aliasesContent: ReactNode;
  branchesContent: ReactNode;
  commitsContent: ReactNode;
}

export function RefSelectorTabs({
  activeTab,
  onTabChange,
  aliasCount,
  branchCount,
  commitCount,
  aliasesContent,
  branchesContent,
  commitsContent,
}: RefSelectorTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as RefSelectorTab)}
      className="flex flex-col flex-1 overflow-hidden"
      aria-label="Reference types"
    >
      {/* Tab List */}
      <div className="border-b px-2">
        <TabsList className="w-full h-10 bg-transparent p-0 justify-start gap-1" aria-label="Reference categories">
          <TabsTrigger
            value="aliases"
            id="tab-aliases"
            aria-controls="panel-aliases"
            className={cn(
              'flex-1 data-[state=active]:bg-accent data-[state=active]:shadow-none',
              'rounded-b-none border-b-2 border-transparent',
              'data-[state=active]:border-primary'
            )}
          >
            <Tag className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Aliases</span>
            <TabBadge count={aliasCount} label="aliases" />
          </TabsTrigger>

          <TabsTrigger
            value="branches"
            id="tab-branches"
            aria-controls="panel-branches"
            className={cn(
              'flex-1 data-[state=active]:bg-accent data-[state=active]:shadow-none',
              'rounded-b-none border-b-2 border-transparent',
              'data-[state=active]:border-primary'
            )}
          >
            <GitBranch className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Branches</span>
            <TabBadge count={branchCount} label="branches" />
          </TabsTrigger>

          <TabsTrigger
            value="commits"
            id="tab-commits"
            aria-controls="panel-commits"
            className={cn(
              'flex-1 data-[state=active]:bg-accent data-[state=active]:shadow-none',
              'rounded-b-none border-b-2 border-transparent',
              'data-[state=active]:border-primary'
            )}
          >
            <GitCommit className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Commits</span>
            <TabBadge count={commitCount} label="commits" />
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Tab Content */}
      <TabsContent
        value="aliases"
        id="panel-aliases"
        aria-labelledby="tab-aliases"
        className="flex-1 overflow-auto m-0 mt-0"
      >
        {aliasesContent}
      </TabsContent>

      <TabsContent
        value="branches"
        id="panel-branches"
        aria-labelledby="tab-branches"
        className="flex-1 overflow-auto m-0 mt-0"
      >
        {branchesContent}
      </TabsContent>

      <TabsContent
        value="commits"
        id="panel-commits"
        aria-labelledby="tab-commits"
        className="flex-1 overflow-auto m-0 mt-0"
      >
        {commitsContent}
      </TabsContent>
    </Tabs>
  );
}

// Badge component for count
function TabBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;

  const displayCount = count > 99 ? '99+' : count;

  return (
    <span
      className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground"
      aria-label={`${count} ${label}`}
    >
      {displayCount}
    </span>
  );
}
