import { ChevronDown, Loader2, Shield, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import {
  useGetDomainBlocklistsQuery,
  useListBlocklistsQuery,
  useSyncDomainBlocklistsMutation,
} from '@/services/trafficApi';

interface DomainBlocklistsSectionProps {
  domainId: string;
  domain: string;
}

/**
 * Per-domain Blocklist attachment (issue #393), mirroring how proxy rule sets
 * attach to aliases: a popover multi-select over the admin-global library plus
 * removable badges. Changes apply immediately — the backend rebuilds app-side
 * enforcement and regenerates this domain's nginx config behind the save.
 *
 * Lists marked "all domains" already apply here without an attachment; the
 * Baseline always applies. Curate both from the Traffic page's Blocklist tab.
 */
export function DomainBlocklistsSection({ domainId, domain }: DomainBlocklistsSectionProps) {
  const { toast } = useToast();
  const { data: blocklists, isLoading: listsLoading } = useListBlocklistsQuery();
  const { data: attached, isLoading: attachedLoading } = useGetDomainBlocklistsQuery(domainId);
  const [syncDomainBlocklists, { isLoading: saving }] = useSyncDomainBlocklistsMutation();

  const loading = listsLoading || attachedLoading;
  const attachedIds = attached?.blocklistIds ?? [];
  const byId = new Map((blocklists ?? []).map((list) => [list.id, list]));

  const applySelection = async (blocklistIds: string[]) => {
    try {
      await syncDomainBlocklists({ domainMappingId: domainId, blocklistIds }).unwrap();
      toast({
        title: 'Blocklists updated',
        description: `Enforcement for ${domain} now includes the Baseline, all-domain lists, and ${blocklistIds.length} attached list${blocklistIds.length === 1 ? '' : 's'}.`,
      });
    } catch {
      toast({ title: 'Could not update the attached Blocklists', variant: 'destructive' });
    }
  };

  const toggle = (id: string) => {
    void applySelection(
      attachedIds.includes(id) ? attachedIds.filter((x) => x !== id) : [...attachedIds, id],
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#d96459]" />
          Blocklists
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Attach named Blocklists to this domain. Its effective rules are the Baseline +
          all-domain lists + everything attached here, enforced at the edge and in the app.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Blocklists…
          </div>
        ) : (blocklists?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Blocklists exist yet — create them on the Traffic page&apos;s Blocklist tab. The
            Baseline still protects this domain while bot protection is on.
          </p>
        ) : (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-between w-full" disabled={saving}>
                  <span className="text-sm truncate">
                    {attachedIds.length === 0
                      ? 'None attached (Baseline + all-domain lists apply)'
                      : `${attachedIds.length} Blocklist${attachedIds.length !== 1 ? 's' : ''} attached`}
                  </span>
                  {saving ? (
                    <Loader2 className="h-4 w-4 ml-2 shrink-0 animate-spin" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                {blocklists?.map((list) => (
                  <Label
                    key={list.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer font-normal"
                  >
                    <Checkbox
                      checked={attachedIds.includes(list.id)}
                      disabled={saving}
                      onCheckedChange={() => toggle(list.id)}
                    />
                    <span className="text-sm">{list.name}</span>
                    {list.isDefault && (
                      <span className="text-xs text-muted-foreground">(already on all domains)</span>
                    )}
                  </Label>
                ))}
              </PopoverContent>
            </Popover>
            {attachedIds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {attachedIds.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    {byId.get(id)?.name ?? id.substring(0, 8)}
                    <button
                      type="button"
                      aria-label={`Detach ${byId.get(id)?.name ?? id}`}
                      className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                      disabled={saving}
                      onClick={() => toggle(id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
