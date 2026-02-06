import { useState } from 'react';
import { RepositorySidebar } from '@/components/repositories/RepositorySidebar';
import { GlobalSearchBar } from '@/components/repositories/GlobalSearchBar';
import { ActivityFeed } from '@/components/repositories/ActivityFeed';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';

export function RepositoriesPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Mobile header with hamburger menu - visible only on mobile */}
      <div className="md:hidden sticky top-0 z-50 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Open repository menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] p-0">
            <SheetTitle className="sr-only">Repository Navigation</SheetTitle>
            <RepositorySidebar />
          </SheetContent>
        </Sheet>
        <h1 className="text-lg font-semibold">Repositories</h1>
      </div>

      {/* Main flex container for desktop sidebar and content */}
      <div className="flex flex-1">
        {/* Desktop sidebar - hidden on mobile */}
        <aside className="hidden md:block">
          <RepositorySidebar />
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <GlobalSearchBar />
            <ActivityFeed />
          </div>
        </main>
      </div>
    </div>
  );
}
