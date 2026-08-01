import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpCircle } from 'lucide-react';
import type { GateResult } from '@/services/appCatalogApi';

/**
 * The disabled CTA a failing instance gate produces: the gate's own message
 * IS the button label, with its remediation behind a "Why?" popover. Shared
 * by the card's Install and Update CTAs and by the details dialog — the same
 * gates block all of them (an update re-runs `instanceGates` server-side and
 * would fail the job), so they must present the blockage identically.
 */
export function GateBlockedCta({ gate }: { gate: GateResult }) {
  return (
    <>
      <Button disabled aria-label={gate.message}>
        {gate.message}
      </Button>
      {(gate.remediation || gate.deepLink) && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Why?">
              <HelpCircle className="h-4 w-4 mr-1" />
              Why?
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            {gate.remediation && <p className="text-sm">{gate.remediation}</p>}
            {gate.deepLink && (
              <a href={gate.deepLink} className="text-sm text-primary underline mt-2 inline-block">
                Fix it now
              </a>
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
