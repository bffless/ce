import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldPlus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  BlocklistMatchType,
  useAppendBlocklistEntryMutation,
  useListBlocklistsQuery,
} from '@/services/trafficApi';

const MATCH_TYPES: Array<{ value: BlocklistMatchType; label: string }> = [
  { value: 'prefix', label: 'Prefix — path starts with' },
  { value: 'exact', label: 'Exact — path equals' },
  { value: 'suffix', label: 'Suffix — path ends with' },
  { value: 'extension', label: 'Extension — file extension' },
  { value: 'contains', label: 'Contains — anywhere in the path' },
];

export interface AddToBlocklistTarget {
  /** The offending path, prefilled as the pattern value (query string stripped). */
  path: string;
  /** The host the request hit, used to preselect a Blocklist attached to it. */
  host?: string | null;
}

interface AddToBlocklistDialogProps {
  target: AddToBlocklistTarget | null;
  onOpenChange: (open: boolean) => void;
}

/** www-insensitive host → attached/default Blocklist match (#393). */
function hostMatchesDomain(host: string, domain: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, '')
      .replace(/^www\./, '');
  return normalize(host) === normalize(domain);
}

/**
 * The inline "add to blocklist" action from the Traffic views (issue #393):
 * pick a target Blocklist (defaulting to one that already applies to the
 * request's domain), adjust the pattern, and append it. The backend rebuilds
 * enforcement and regenerates the edge configs immediately.
 */
export function AddToBlocklistDialog({ target, onOpenChange }: AddToBlocklistDialogProps) {
  const { toast } = useToast();
  const { data: blocklists, isLoading } = useListBlocklistsQuery(undefined, {
    skip: target === null,
  });
  const [appendEntry, { isLoading: saving }] = useAppendBlocklistEntryMutation();

  const [blocklistId, setBlocklistId] = useState('');
  const [matchType, setMatchType] = useState<BlocklistMatchType>('prefix');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A list already covering the request's domain is the natural target.
  const defaultTargetId = useMemo(() => {
    if (!blocklists || blocklists.length === 0) {
      return '';
    }
    const host = target?.host;
    if (host) {
      const attachedToHost = blocklists.find((list) =>
        list.attachedDomains.some((ref) => hostMatchesDomain(host, ref.domain)),
      );
      if (attachedToHost) {
        return attachedToHost.id;
      }
    }
    return (blocklists.find((list) => list.isDefault) ?? blocklists[0]).id;
  }, [blocklists, target?.host]);

  useEffect(() => {
    if (target) {
      setMatchType('prefix');
      setValue(target.path);
      setError(null);
    }
  }, [target]);

  useEffect(() => {
    setBlocklistId(defaultTargetId);
  }, [defaultTargetId]);

  const handleAdd = async () => {
    if (!blocklistId || !value.trim()) return;
    try {
      const updated = await appendEntry({
        id: blocklistId,
        matchType,
        value: value.trim(),
      }).unwrap();
      toast({
        title: `Added to "${updated.name}"`,
        description: 'Matching requests are refused within seconds, app-side and at the edge.',
      });
      onOpenChange(false);
    } catch (err) {
      const data = (err as { data?: { errors?: string[]; message?: string } })?.data;
      setError(data?.errors?.[0] ?? data?.message ?? 'Adding the pattern failed');
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldPlus className="h-4 w-4 text-[#d96459]" />
            Add to Blocklist
          </DialogTitle>
          <DialogDescription>
            Block requests matching this pattern
            {target?.host ? (
              <>
                {' '}
                (seen on <span className="font-mono">{target.host}</span>)
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Blocklists…
          </div>
        ) : (blocklists?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Blocklists exist yet — create one on the Blocklist tab first, then add patterns to it
            from here.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="add-blocklist-target">Blocklist</Label>
              <Select value={blocklistId} onValueChange={setBlocklistId}>
                <SelectTrigger id="add-blocklist-target">
                  <SelectValue placeholder="Choose a Blocklist" />
                </SelectTrigger>
                <SelectContent>
                  {blocklists?.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                      {list.isDefault
                        ? ' — all domains'
                        : list.attachedDomains.length > 0
                          ? ` — ${list.attachedDomains.length} domain${list.attachedDomains.length === 1 ? '' : 's'}`
                          : ' — not attached'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-blocklist-match-type">Match type</Label>
              <Select
                value={matchType}
                onValueChange={(v) => setMatchType(v as BlocklistMatchType)}
              >
                <SelectTrigger id="add-blocklist-match-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-blocklist-value">Pattern</Label>
              <Input
                id="add-blocklist-value"
                className="font-mono text-xs"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={saving || !blocklistId || !value.trim() || (blocklists?.length ?? 0) === 0}
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Block it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
