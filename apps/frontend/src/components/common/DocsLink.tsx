import type { ReactNode } from 'react';
import { BookOpen, ExternalLink, Play } from 'lucide-react';
import { formatTimestamp, youtubeUrl } from '@/lib/docsLinks';

interface DocsLinkProps {
  href: string;
  label: string;
}

/**
 * Prominent bordered row pointing at a docs page.
 *
 * Reserved for the setup wizard, where the operator is mid-task and may be
 * blocked: the link has to be unmissable. Day-2 settings pages use
 * DocsInlineLink instead — the reader there already succeeded once and the
 * pages are dense.
 */
export function DocsLink({ href, label }: DocsLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:border-[#d96459]/50 hover:bg-muted/50"
    >
      <BookOpen className="h-4 w-4 flex-shrink-0 text-[#d96459]" />
      <span className="font-medium">{label}</span>
      <ExternalLink className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
    </a>
  );
}

interface DocsInlineLinkProps {
  href: string;
  children: ReactNode;
}

/** Quiet inline anchor, sized to flow inside body copy or a CardDescription. */
export function DocsInlineLink({ href, children }: DocsInlineLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
    >
      {children}
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
    </a>
  );
}

interface WatchLinkProps {
  videoId: string;
  start: number;
}

/**
 * Compact link opening the walkthrough at a given moment.
 *
 * Deliberately not an embed: on a wizard step the operator is already
 * alt-tabbing to a third-party dashboard, and a 16:9 player inside the form
 * competes with the fields it is meant to explain. WelcomeStep keeps its
 * facade embed because there, watching IS the task.
 */
export function WatchLink({ videoId, start }: WatchLinkProps) {
  return (
    <a
      href={youtubeUrl(videoId, start)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <Play className="h-3.5 w-3.5 flex-shrink-0 fill-current" />
      <span>Watch this step ({formatTimestamp(start)})</span>
    </a>
  );
}
