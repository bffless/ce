import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
  useGetUninstallPreviewQuery,
  useLazyGetEjectPayloadQuery,
  useUninstallAppMutation,
  useUpdateAppMutation,
  type CatalogEntry,
} from '@/services/appCatalogApi';
import { ExternalLink, MoreVertical, HelpCircle, Copy, Check } from 'lucide-react';

interface AppCardProps {
  entry: CatalogEntry;
  /** Opens the install wizard dialog (Task 13/14) for this app. */
  onInstall: (entry: CatalogEntry) => void;
}

/**
 * AppCard — the catalog grid tile for a single app (Task 12 of the
 * app-catalog spec). Implements the CTA state machine from the spec:
 *
 * - not installed, no failing instance gate → "Install" (opens the wizard
 *   dialog via `onInstall`, built out in Tasks 13-14).
 * - not installed, a gate fails → disabled CTA showing the gate's message,
 *   plus a "Why?" popover with the gate's remediation/deepLink.
 * - installed → "Installed · v{version}" badge, an "Open" link to `appUrl`,
 *   and an overflow menu (Update, Uninstall, Eject).
 * - installed + update available → an additional primary "Update to
 *   v{registryVersion}" button.
 *
 * Update/Uninstall/Eject are simple one-shot admin actions, so this card
 * wires them directly to `appCatalogApi` mutations rather than deferring to
 * the wizard dialog (which owns the multi-step preflight → install → job
 * progress flow).
 */
export function AppCard({ entry, onInstall }: AppCardProps) {
  const { toast } = useToast();
  const { installed } = entry;
  const failedGate = entry.gates.find((gate) => gate.status === 'fail');

  const [updateApp, { isLoading: isUpdating }] = useUpdateAppMutation();
  const [uninstallApp, { isLoading: isUninstalling }] = useUninstallAppMutation();
  const [ejectOpen, setEjectOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const { data: uninstallPreview } = useGetUninstallPreviewQuery(installed?.installedAppId ?? '', {
    skip: !installed || !uninstallOpen,
  });
  const [triggerEject, { data: ejectPayload, isFetching: isEjecting }] = useLazyGetEjectPayloadQuery();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleUpdate = async () => {
    if (!installed) return;
    try {
      await updateApp({ id: installed.installedAppId }).unwrap();
      toast({ title: 'Update started', description: `Updating ${entry.name}…` });
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Update failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleUninstall = async () => {
    if (!installed) return;
    try {
      await uninstallApp({ id: installed.installedAppId }).unwrap();
      toast({ title: 'Uninstalled', description: `${entry.name} was uninstalled.` });
      setUninstallOpen(false);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Uninstall failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleEject = () => {
    if (!installed) return;
    setEjectOpen(true);
    void triggerEject(installed.installedAppId);
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: 'Failed to copy', description: 'Could not copy to clipboard', variant: 'destructive' });
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        {entry.iconUrl && (
          <img src={entry.iconUrl} alt="" className="h-10 w-10 rounded-md object-cover" />
        )}
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight truncate">{entry.name}</h3>
          {entry.summary && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{entry.summary}</p>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        {installed && (
          <Badge variant="secondary">{`Installed · v${installed.version}`}</Badge>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {!installed && !failedGate && (
          <Button disabled={!entry.installable} onClick={() => onInstall(entry)}>
            Install
          </Button>
        )}

        {!installed && failedGate && (
          <>
            <Button disabled aria-label={failedGate.message}>
              {failedGate.message}
            </Button>
            {(failedGate.remediation || failedGate.deepLink) && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="Why?">
                    <HelpCircle className="h-4 w-4 mr-1" />
                    Why?
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  {failedGate.remediation && <p className="text-sm">{failedGate.remediation}</p>}
                  {failedGate.deepLink && (
                    <a
                      href={failedGate.deepLink}
                      className="text-sm text-primary underline mt-2 inline-block"
                    >
                      Fix it now
                    </a>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </>
        )}

        {installed && (
          <>
            {installed.updateAvailable && entry.registryVersion && (
              <Button onClick={handleUpdate} disabled={isUpdating}>
                {`Update to v${entry.registryVersion}`}
              </Button>
            )}

            {installed.appUrl && (
              <Button asChild variant={installed.updateAvailable ? 'outline' : 'default'}>
                <a href={installed.appUrl} target="_blank" rel="noopener noreferrer">
                  Open
                  <ExternalLink className="h-4 w-4 ml-1" />
                </a>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setUninstallOpen(true)}>Uninstall</DropdownMenuItem>
                <DropdownMenuItem onSelect={handleEject}>Eject</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{`Uninstall ${entry.name}?`}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {uninstallPreview && uninstallPreview.dataTables.length > 0
                      ? `This app created ${uninstallPreview.dataTables.length} data table(s). Data is kept by default; you can delete it from Data Tables afterward if you no longer need it.`
                      : 'This removes the proxy rules, alias, and domain this install created. Data tables are kept by default.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleUninstall} disabled={isUninstalling}>
                    Uninstall
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Dialog open={ejectOpen} onOpenChange={setEjectOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{`Eject ${entry.name}`}</DialogTitle>
                  <DialogDescription>
                    Fork the app's source repo and deploy it yourself — you'll own upkeep from here on.
                  </DialogDescription>
                </DialogHeader>
                {isEjecting && <p className="text-sm text-muted-foreground">Loading…</p>}
                {ejectPayload && (
                  <div className="space-y-3 text-sm">
                    <p>{ejectPayload.note}</p>
                    <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <code className="truncate">{ejectPayload.repo}</code>
                      <a
                        href={ejectPayload.forkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline whitespace-nowrap"
                      >
                        Fork on GitHub
                      </a>
                    </div>
                    {Object.keys(ejectPayload.variables).length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Actions variables</p>
                        <ul className="space-y-1">
                          {Object.entries(ejectPayload.variables).map(([key, value]) => (
                            <li
                              key={key}
                              className="flex items-center justify-between gap-2 rounded-md border p-2"
                            >
                              <code className="truncate">
                                {key}={value}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyToClipboard(`${key}=${value}`, key)}
                                aria-label={`Copy ${key}`}
                              >
                                {copiedField === key ? (
                                  <Check className="h-4 w-4" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {ejectPayload.secrets.length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Actions secrets to set</p>
                        <p className="text-muted-foreground">{ejectPayload.secrets.join(', ')}</p>
                      </div>
                    )}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
