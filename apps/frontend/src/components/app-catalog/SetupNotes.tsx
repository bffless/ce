import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppManualStep } from '@/services/appCatalogApi';

interface SetupNotesProps {
  steps: AppManualStep[];
  /** The install dialog has room to show every body; the card does not. */
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * SetupNotes — the app's post-install advice, rendered identically on the
 * install dialog's Done screen and on the installed card.
 *
 * These are notes, not steps: CE cannot grant a user access or write a CORS
 * rule on someone's bucket, and it never claimed to. The list used to carry
 * checkboxes whose only effect was to store their own checked state, which
 * made the copy work harder to explain what the control did not do. Nothing
 * here is stateful.
 */
export function SetupNotes({ steps, defaultExpanded = false, className }: SetupNotesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpanded ? steps.map((step) => step.id) : []),
  );

  if (steps.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium">
        Setup notes{' '}
        <span className="font-normal text-muted-foreground">— CE can&apos;t do these for you</span>
      </p>

      <ul className="space-y-1">
        {steps.map((step) => {
          const isOpen = expanded.has(step.id);
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => toggle(step.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-1 text-left text-sm hover:underline"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span>{step.title}</span>
              </button>

              {isOpen && (
                <div className="ml-5 mt-1 space-y-1">
                  {step.body && <p className="text-sm text-muted-foreground">{step.body}</p>}
                  {(step.deepLink || step.externalLink) && (
                    <div className="flex items-center gap-3">
                      {step.deepLink && (
                        <a href={step.deepLink} className="text-sm text-primary underline">
                          Go
                        </a>
                      )}
                      {step.externalLink && (
                        <a
                          href={step.externalLink.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary underline"
                        >
                          {step.externalLink.label}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
