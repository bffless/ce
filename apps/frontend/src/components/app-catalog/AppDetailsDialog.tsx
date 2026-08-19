import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RemoteImage } from './RemoteImage';
import { GateBlockedCta } from './GateBlockedCta';
import { InstallsList } from './InstallsList';
import type { CatalogEntry } from '@/services/appCatalogApi';
import { ExternalLink } from 'lucide-react';

interface AppDetailsDialogProps {
  entry: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hands off to the install wizard — the page swaps this dialog for it. */
  onInstall: (entry: CatalogEntry) => void;
  /** A per-install Update was accepted — the page shows the job's progress dialog. */
  onUpdateStarted: (entry: CatalogEntry, jobId: string) => void;
  /** Start the "update all installs" batch as soon as the dialog opens (card CTA). */
  autoUpdateAll?: boolean;
}

/**
 * AppDetailsDialog — the read-before-you-install view for a catalog entry
 * (ce#590). Renders the store metadata `registry.json` carries but the grid
 * tile has no room for: the markdown `description`, the `screenshots[]`
 * gallery, and the docs/source links, with the same Install CTA (and the same
 * gate blocking) as the card so the operator never has to back out to act.
 *
 * The description is third-party markdown from whatever registry the instance
 * points at, so it goes through `react-markdown` WITHOUT `rehype-raw` — raw
 * HTML stays inert, and react-markdown's default URL transform already drops
 * `javascript:` hrefs. Don't add `rehype-raw` here.
 */
export function AppDetailsDialog({
  entry,
  open,
  onOpenChange,
  onInstall,
  onUpdateStarted,
  autoUpdateAll,
}: AppDetailsDialogProps) {
  const { installs } = entry;
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');
  const screenshots = entry.screenshots ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Flex column rather than the house "whole dialog scrolls" pattern: a
        store description can run for screens, and the Install CTA must not
        drift below the fold. Only the middle band scrolls.
      */}
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <div className="flex items-start gap-3 text-left">
            <RemoteImage
              src={entry.iconUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-md object-cover"
            />
            <div className="min-w-0">
              <DialogTitle>{entry.name}</DialogTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {entry.registryVersion && (
                  <span className="text-xs text-muted-foreground">v{entry.registryVersion}</span>
                )}
                {entry.category && (
                  <Badge variant="outline" className="capitalize">
                    {entry.category}
                  </Badge>
                )}
                {installs.length === 1 && (
                  <Badge variant="secondary">{`Installed · v${installs[0].version}`}</Badge>
                )}
                {installs.length > 1 && (
                  <Badge variant="secondary">{`Installed in ${installs.length} projects`}</Badge>
                )}
              </div>
            </div>
          </div>
          {entry.summary && (
            <DialogDescription className="text-left pt-1">{entry.summary}</DialogDescription>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {installs.length > 0 && (
            <InstallsList
              entry={entry}
              onUpdateStarted={onUpdateStarted}
              onViewJob={onUpdateStarted}
              autoUpdateAll={autoUpdateAll}
            />
          )}

          {screenshots.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {screenshots.map((src) => (
                <RemoteImage
                  key={src}
                  src={src}
                  alt={`${entry.name} screenshot`}
                  className="w-full rounded-md border object-cover"
                />
              ))}
            </div>
          )}

          {entry.description && (
            <article
              className="markdown-body prose prose-sm dark:prose-invert max-w-none
                prose-headings:font-semibold
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-muted prose-pre:border prose-pre:text-foreground
                prose-img:rounded prose-hr:border-border"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.description}</ReactMarkdown>
            </article>
          )}

          {(entry.docsUrl || entry.sourceUrl) && (
            <div className="flex flex-wrap gap-4 text-sm">
              {entry.docsUrl && (
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Documentation
                </a>
              )}
              {entry.sourceUrl && (
                <a
                  href={entry.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Source code
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {failedGate && <GateBlockedCta gate={failedGate} />}

          {!failedGate && (
            <Button
              variant={installs.length > 0 ? 'outline' : 'default'}
              disabled={!entry.installable}
              onClick={() => onInstall(entry)}
            >
              {installs.length > 0 ? 'Install in another project' : 'Install'}
            </Button>
          )}

          {installs.length === 1 && installs[0].appUrl && (
            <Button asChild>
              <a href={installs[0].appUrl} target="_blank" rel="noopener noreferrer">
                Open
                <ExternalLink className="h-4 w-4 ml-1" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
