import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  useGetUninstallPreviewQuery,
  useUninstallAppMutation,
  type CatalogEntry,
} from '@/services/appCatalogApi';

interface UninstallDialogProps {
  entry: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * UninstallDialog — the dedicated uninstall confirmation (Task 14 of the
 * app-catalog spec). Replaces the simple confirm-only AlertDialog that
 * shipped inline in AppCard for Task 12: this version loads the real
 * preview (`useGetUninstallPreviewQuery`) so the "delete data tables"
 * checkbox can show the actual record counts before the user commits.
 */
export function UninstallDialog({ entry, open, onOpenChange }: UninstallDialogProps) {
  const { toast } = useToast();
  const { installed } = entry;
  const [deleteData, setDeleteData] = useState(false);
  const [failures, setFailures] = useState<string[] | null>(null);

  const { data: preview } = useGetUninstallPreviewQuery(installed?.installedAppId ?? '', {
    skip: !open || !installed,
  });
  const [uninstallApp, { isLoading }] = useUninstallAppMutation();

  const dataTables = preview?.dataTables ?? [];
  const deletableTables = dataTables.filter((table) => table.createdByInstall);
  const keptTables = dataTables.filter((table) => !table.createdByInstall);
  const deletableRecordCount = deletableTables.reduce((sum, table) => sum + table.recordCount, 0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDeleteData(false);
      setFailures(null);
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (!installed) return;
    try {
      const summary = await uninstallApp({ id: installed.installedAppId, deleteData }).unwrap();
      // The backend deliberately keeps the installed_apps row when some
      // cleanup steps fail, so the user can retry — don't tell them it
      // succeeded, and don't close the dialog out from under a retry.
      if (summary.failures && summary.failures.length > 0) {
        setFailures(summary.failures);
        toast({
          title: 'Uninstall incomplete',
          description: `Failed to remove: ${summary.failures.join(', ')}. The install was kept — retry when ready.`,
          variant: 'destructive',
        });
        return;
      }
      setFailures(null);
      toast({ title: `${entry.name} uninstalled`, description: summary.note });
      handleOpenChange(false);
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Uninstall failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Uninstall ${entry.name}?`}</DialogTitle>
          <DialogDescription>
            Removes the app&apos;s rule sets, alias, domain, and deployment. Your data tables
            and uploaded files are kept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {failures && failures.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                {`Uninstall incomplete — failed to remove: ${failures.join(', ')}. The install was kept so you can retry.`}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-start gap-2">
            <Checkbox
              id="uninstall-delete-data"
              checked={deleteData}
              onCheckedChange={(checked) => setDeleteData(checked === true)}
            />
            <Label htmlFor="uninstall-delete-data" className="font-normal">
              Also delete the app&apos;s data tables
            </Label>
          </div>

          {deleteData && (
            <p className="text-sm text-muted-foreground">
              {deletableTables.length > 0
                ? `this deletes ${deletableRecordCount} records across ${deletableTables.length} tables`
                : "This install didn't create any data tables of its own — nothing extra to delete."}
            </p>
          )}

          {keptTables.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Kept regardless (reused, not created by this install):</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {keptTables.map((table) => (
                  <li key={table.name}>{`${table.name} (${table.recordCount} records)`}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isLoading || !installed}>
            {isLoading ? 'Uninstalling…' : failures ? 'Retry uninstall' : 'Uninstall'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
