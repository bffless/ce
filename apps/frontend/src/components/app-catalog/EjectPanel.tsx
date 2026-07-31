import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useGetEjectPayloadQuery, type CatalogEntry } from '@/services/appCatalogApi';
import { useCreateApiKeyMutation } from '@/services/apiKeysApi';
import { Check, Copy, ExternalLink, Key } from 'lucide-react';

interface EjectPanelProps {
  entry: CatalogEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * EjectPanel — "own it yourself" flow (Task 14 of the app-catalog spec).
 * Replaces the inline eject Dialog that shipped in AppCard for Task 12:
 * this version renders the exact Actions variables table with copy
 * buttons and lets the user mint the deploy API key for the secrets list
 * inline, without leaving the panel.
 */
export function EjectPanel({ entry, open, onOpenChange }: EjectPanelProps) {
  const { toast } = useToast();
  const { installed } = entry;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mintedKeys, setMintedKeys] = useState<Record<string, string>>({});

  const { data: payload, isFetching } = useGetEjectPayloadQuery(installed?.installedAppId ?? '', {
    skip: !open || !installed,
  });
  const [createApiKey, { isLoading: isMinting }] = useCreateApiKeyMutation();

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleMint = async (secretName: string) => {
    try {
      const response = await createApiKey({
        name: `${entry.name} eject — ${secretName}`,
        repository: installed?.projectName,
      }).unwrap();
      setMintedKeys((prev) => ({ ...prev, [secretName]: response.key }));
      toast({
        title: 'API key minted',
        description: "Copy it now — it won't be shown again.",
      });
    } catch (err) {
      const message = (err as { data?: { message?: string } })?.data?.message ?? 'Failed to mint API key';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Eject ${entry.name}`}</DialogTitle>
          <DialogDescription>
            Fork the app&apos;s source repo and deploy it yourself — you&apos;ll own upkeep from
            here on.
          </DialogDescription>
        </DialogHeader>

        {isFetching && !payload && <p className="text-sm text-muted-foreground">Loading…</p>}

        {payload && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <code className="truncate">{payload.repo}</code>
              <a
                href={payload.forkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline"
              >
                Fork on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {Object.keys(payload.variables).length > 0 && (
              <div>
                <p className="mb-1 font-medium">Actions variables</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="text-right">Copy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(payload.variables).map(([key, value]) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-xs">{key}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs">
                          {value}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(value, key)}
                            aria-label={`Copy ${key}`}
                          >
                            {copiedField === key ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {payload.secrets.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Actions secrets to set</p>
                <ul className="space-y-2">
                  {payload.secrets.map((secretName) => (
                    <li
                      key={secretName}
                      className="flex items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="min-w-0">
                        <code className="block truncate">{secretName}</code>
                        {mintedKeys[secretName] && (
                          <div className="mt-1 flex items-center gap-2">
                            <code className="truncate text-xs">{mintedKeys[secretName]}</code>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(mintedKeys[secretName], secretName)}
                              aria-label={`Copy ${secretName} value`}
                            >
                              {copiedField === secretName ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMint(secretName)}
                        disabled={isMinting}
                      >
                        <Key className="mr-1 h-4 w-4" />
                        Mint API key
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  {installed?.projectName
                    ? `Scoped to ${installed.projectName}.`
                    : 'Minted as a global key — no project scope available for this install.'}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1 font-medium">Workflow to run</p>
              <code className="text-xs">{payload.deployWorkflow}</code>
            </div>

            <p className="text-muted-foreground">
              The workflow&apos;s first deploy lands on this same alias — your install becomes
              the fork&apos;s deploy target.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
