import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  BlocklistEntry,
  useCreateBlocklistMutation,
  useDeleteBlocklistMutation,
  useGetBaselineBlocklistQuery,
  useGetBlocklistSettingsQuery,
  useListBlocklistsQuery,
  useUpdateBlocklistMutation,
  useUpdateBlocklistSettingsMutation,
} from '@/services/trafficApi';
import { formatPatternEntries, parsePatternLines } from './blocklist-format';

/**
 * Blocklist configuration on the Traffic page (issue #391): the bot-protection
 * master toggle, the code-shipped Baseline (read-only), and the admin-global
 * library of named Blocklists with their patterns + allowlist exceptions.
 *
 * App-side enforcement takes effect within seconds of saving; edge (nginx)
 * enforcement rides on top in a later slice (#392).
 */
export function TrafficBlocklistTab() {
  return (
    <div className="space-y-6">
      <MasterToggleCard />
      <BlocklistLibraryCard />
    </div>
  );
}

function MasterToggleCard() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetBlocklistSettingsQuery();
  const [updateSettings, { isLoading: saving }] = useUpdateBlocklistSettingsMutation();
  const [showBaseline, setShowBaseline] = useState(false);
  const { data: baseline } = useGetBaselineBlocklistQuery(undefined, { skip: !showBaseline });

  const handleToggle = async (enabled: boolean) => {
    try {
      await updateSettings({ enabled }).unwrap();
      toast({
        title: enabled ? 'Bot protection enabled' : 'Bot protection disabled',
        description: enabled
          ? 'The Baseline and your Blocklists are enforced again.'
          : 'Nothing is blocked until you turn it back on.',
      });
    } catch {
      toast({ title: 'Could not update bot protection', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#d96459]" />
              Bot protection
            </CardTitle>
            <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-1">
              Requests matching the Baseline or a Blocklist are refused with an empty 403 before
              they reach any content. Turning this off disables all blocking instantly.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(isLoading || saving) && <Loader2 className="h-4 w-4 animate-spin" />}
            <Switch
              id="bot-protection"
              checked={settings?.enabled ?? false}
              disabled={isLoading || saving}
              onCheckedChange={handleToggle}
            />
            <Label htmlFor="bot-protection" className="text-sm cursor-pointer">
              {settings?.enabled ? 'On' : 'Off'}
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-[#4a4a4a] dark:text-muted-foreground hover:text-foreground"
          onClick={() => setShowBaseline((open) => !open)}
        >
          {showBaseline ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Baseline: {settings?.baselineEntryCount ?? '…'} scanner signatures shipped with CE
          (updated on upgrade, not editable)
        </button>
        {showBaseline && (
          <div className="mt-2 bg-[#1e1e1e] rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs leading-5 text-gray-200">
            {baseline ? (
              baseline.entries.map((entry, index) => (
                <div key={index}>
                  {entry.matchType === 'prefix' ? entry.value : `${entry.matchType}:${entry.value}`}
                </div>
              ))
            ) : (
              <p className="text-gray-400">Loading…</p>
            )}
          </div>
        )}
        <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-2">
          A false positive? Add the path to a Blocklist&apos;s allowlist below — allowlist
          exceptions always win, including over the Baseline.
        </p>
      </CardContent>
    </Card>
  );
}

interface EditorState {
  id: string | null; // null = creating
  name: string;
  description: string;
  patternsText: string;
  allowlistText: string;
}

const emptyEditor = (): EditorState => ({
  id: null,
  name: '',
  description: '',
  patternsText: '',
  allowlistText: '',
});

const editorFor = (list: BlocklistEntry): EditorState => ({
  id: list.id,
  name: list.name,
  description: list.description ?? '',
  patternsText: formatPatternEntries(list.entries),
  allowlistText: formatPatternEntries(list.allowlist),
});

/** Pull the per-pattern error list out of a 400 from the backend. */
function extractErrors(error: unknown): string[] {
  const data = (error as { data?: { errors?: string[]; message?: string } })?.data;
  if (Array.isArray(data?.errors)) {
    return data.errors;
  }
  return [typeof data?.message === 'string' ? data.message : 'Saving the Blocklist failed'];
}

function BlocklistLibraryCard() {
  const { toast } = useToast();
  const { data: blocklists, isLoading, error } = useListBlocklistsQuery();
  const [createBlocklist, { isLoading: creating }] = useCreateBlocklistMutation();
  const [updateBlocklist, { isLoading: updating }] = useUpdateBlocklistMutation();
  const [deleteBlocklist] = useDeleteBlocklistMutation();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErrors, setEditorErrors] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<BlocklistEntry | null>(null);
  const saving = creating || updating;

  const handleSave = async () => {
    if (!editor) return;
    const payload = {
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      entries: parsePatternLines(editor.patternsText),
      allowlist: parsePatternLines(editor.allowlistText),
    };
    try {
      if (editor.id === null) {
        await createBlocklist(payload).unwrap();
      } else {
        await updateBlocklist({ id: editor.id, ...payload }).unwrap();
      }
      toast({
        title: editor.id === null ? 'Blocklist created' : 'Blocklist updated',
        description: 'App-side enforcement is live; edge rules follow in a later release.',
      });
      setEditor(null);
      setEditorErrors([]);
    } catch (err) {
      setEditorErrors(extractErrors(err));
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteBlocklist(pendingDelete.id).unwrap();
      toast({ title: `Deleted "${pendingDelete.name}"` });
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Blocklists</CardTitle>
            <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-1">
              Named pattern lists on top of the Baseline. Until per-domain attachment lands, a
              Blocklist applies to all traffic reaching this instance.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditor(emptyEditor());
              setEditorErrors([]);
            }}
            disabled={editor !== null}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Blocklist
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error !== undefined && (
          <Alert variant="destructive">
            <AlertDescription>Could not load the Blocklist library.</AlertDescription>
          </Alert>
        )}

        {editor && (
          <div className="border rounded-md p-4 space-y-3" data-testid="blocklist-editor">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="blocklist-name">Name</Label>
                <Input
                  id="blocklist-name"
                  value={editor.name}
                  placeholder="e.g. aggressive-scanners"
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="blocklist-description">Description</Label>
                <Input
                  id="blocklist-description"
                  value={editor.description}
                  placeholder="Optional"
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="blocklist-patterns">Blocked patterns (one per line)</Label>
              <Textarea
                id="blocklist-patterns"
                className="font-mono text-xs min-h-32"
                value={editor.patternsText}
                placeholder={'/hidden-probe\nexact:/status\nsuffix:.tar.bz2\nextension:php\ncontains:phpunit'}
                onChange={(e) => setEditor({ ...editor, patternsText: e.target.value })}
              />
              <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-1">
                A bare line matches as a path prefix. Prefix with{' '}
                <code>exact:</code>, <code>suffix:</code>, <code>extension:</code> or{' '}
                <code>contains:</code> for other match types. Lines starting with # are ignored.
              </p>
            </div>
            <div>
              <Label htmlFor="blocklist-allowlist">Allowlist exceptions (one per line)</Label>
              <Textarea
                id="blocklist-allowlist"
                className="font-mono text-xs min-h-20"
                value={editor.allowlistText}
                placeholder={'exact:/status'}
                onChange={(e) => setEditor({ ...editor, allowlistText: e.target.value })}
              />
              <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-1">
                Exceptions always win — over this list and over the Baseline. Use them to rescue a
                legitimate path.
              </p>
            </div>
            {editorErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {editorErrors.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditor(null);
                  setEditorErrors([]);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !editor.name.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {editor.id === null ? 'Create' : 'Save'}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[#4a4a4a] dark:text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Blocklists…
          </div>
        ) : (blocklists?.length ?? 0) === 0 && !editor ? (
          <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground">
            No Blocklists yet. The Baseline still protects every domain while bot protection is on.
          </p>
        ) : (
          <div className="space-y-2">
            {blocklists?.map((list) => (
              <div
                key={list.id}
                className="flex flex-wrap items-center justify-between gap-2 border rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{list.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {list.entries.length} pattern{list.entries.length === 1 ? '' : 's'}
                    </Badge>
                    {list.allowlist.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {list.allowlist.length} exception{list.allowlist.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  {list.description && (
                    <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground truncate">
                      {list.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${list.name}`}
                    onClick={() => {
                      setEditor(editorFor(list));
                      setEditorErrors([]);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${list.name}`}
                    onClick={() => setPendingDelete(list)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its patterns stop blocking within seconds. The Baseline is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
