import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, FileJson, AlertTriangle } from 'lucide-react';
import {
  useImportRuleSetMutation,
  type ProxyRuleSetExport,
  type ImportSchemaResolution,
} from '@/services/proxyRulesApi';
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';
import { collectSchemaIds } from '@/utils/proxyRuleSchemaRefs';
import { useToast } from '@/hooks/use-toast';

interface ImportRuleSetDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sentinel for the "create a fresh schema" option in the resolution selects
const CREATE = '__create__';

/**
 * ImportRuleSetDialog - imports a proxy rule set from an exported JSON file.
 *
 * When the export bundles schema dependencies (v2 exports), the user resolves
 * each one against the target project: reuse an existing schema or create a
 * fresh one. Defaults: match by id (same-project backup), else by name, else
 * create. The chosen resolutions are sent to the backend, which remaps every
 * schema reference in the pipeline configs before insert.
 */
export function ImportRuleSetDialog({ projectId, open, onOpenChange }: ImportRuleSetDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ProxyRuleSetExport | null>(null);
  const [fileName, setFileName] = useState('');
  // sourceSchemaId -> targetSchemaId | CREATE (user overrides; defaults computed below)
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const { data: schemasData } = useGetProjectSchemasQuery(projectId, {
    skip: !projectId || !open,
  });
  const existingSchemas = schemasData?.schemas ?? [];

  const [importRuleSet, { isLoading: isImporting }] = useImportRuleSetMutation();

  const bundledSchemas = parsed?.schemas ?? [];

  // Default resolution for a bundled schema: match by id, then by name, else create
  const defaultFor = (sourceId: string, name: string): string => {
    const byId = existingSchemas.find((s) => s.id === sourceId);
    if (byId) return byId.id;
    const byName = existingSchemas.find((s) => s.name === name);
    if (byName) return byName.id;
    return CREATE;
  };
  const chosenFor = (sourceId: string, name: string): string =>
    resolutions[sourceId] ?? defaultFor(sourceId, name);

  // Schema ids referenced by the rules but not bundled (e.g. a v1 export) — these
  // cannot be remapped and will stay pointing at the source project's schemas.
  const unbundledRefCount = parsed
    ? (() => {
        const bundledIds = new Set(bundledSchemas.map((s) => s.id));
        return [...collectSchemaIds(parsed.rules)].filter((id) => !bundledIds.has(id)).length;
      })()
    : 0;

  const resetState = () => {
    setParsed(null);
    setFileName('');
    setResolutions({});
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    let data: ProxyRuleSetExport;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast({
        title: 'Invalid file',
        description: 'The selected file is not valid JSON.',
        variant: 'destructive',
      });
      return;
    }

    if (!data?.ruleSet?.name || !Array.isArray(data.rules)) {
      toast({
        title: 'Invalid file',
        description: 'This file is not a valid proxy rule set export.',
        variant: 'destructive',
      });
      return;
    }

    setParsed(data);
    setFileName(file.name);
    setResolutions({});
  };

  const handleImport = async () => {
    if (!parsed || !projectId) return;

    const schemaResolutions: ImportSchemaResolution[] = bundledSchemas.map((s) => {
      const target = chosenFor(s.id, s.name);
      return target === CREATE
        ? { sourceId: s.id, name: s.name, fields: s.fields, action: 'create' }
        : { sourceId: s.id, name: s.name, fields: s.fields, action: 'reuse', targetSchemaId: target };
    });

    try {
      // Rebuild the envelope, replacing the bundled schemas (ExportedSchema[])
      // with the per-schema resolutions the backend expects
      const imported = await importRuleSet({
        projectId,
        data: {
          version: parsed.version,
          exportedAt: parsed.exportedAt,
          kind: parsed.kind,
          ruleSet: parsed.ruleSet,
          rules: parsed.rules,
          schemas: schemaResolutions.length > 0 ? schemaResolutions : undefined,
        },
      }).unwrap();

      const createdCount = schemaResolutions.filter((r) => r.action === 'create').length;
      toast({
        title: 'Rule set imported',
        description:
          `Created "${imported.name}" with ${imported.rules.length} rule${imported.rules.length !== 1 ? 's' : ''}.` +
          (createdCount > 0
            ? ` ${createdCount} new schema${createdCount !== 1 ? 's' : ''} created.`
            : ''),
      });
      handleOpenChange(false);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to import rule set';
      toast({
        title: 'Import failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Rule Set</DialogTitle>
          <DialogDescription>
            Import a proxy rule set from an exported JSON file. If it depends on schemas, choose how
            to resolve each one in this project.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFile}
        />

        {!parsed ? (
          <div className="rounded border border-dashed p-8 text-center">
            <FileJson className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              Select a <code>.proxy-rules.json</code> export file to import.
            </p>
            <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Select file
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <div className="font-medium">{parsed.ruleSet.name}</div>
                <div className="text-muted-foreground">
                  {parsed.rules.length} rule{parsed.rules.length !== 1 ? 's' : ''}
                  {bundledSchemas.length > 0 &&
                    ` · ${bundledSchemas.length} schema${bundledSchemas.length !== 1 ? 's' : ''}`}
                  {fileName ? ` · ${fileName}` : ''}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                Change
              </Button>
            </div>

            {bundledSchemas.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Schema dependencies</p>
                <p className="text-xs text-muted-foreground">
                  Reuse an existing schema in this project, or create a fresh one. References in the
                  pipelines are remapped automatically.
                </p>
                <div className="space-y-2">
                  {bundledSchemas.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded border p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.fields.length} field{s.fields.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <Select
                        value={chosenFor(s.id, s.name)}
                        onValueChange={(v) => setResolutions((prev) => ({ ...prev, [s.id]: v }))}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CREATE}>Create new schema</SelectItem>
                          {existingSchemas.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              Reuse: {e.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unbundledRefCount > 0 && (
              <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {unbundledRefCount} schema reference{unbundledRefCount !== 1 ? 's' : ''} in this
                  export {unbundledRefCount !== 1 ? 'are' : 'is'} not bundled and will keep pointing
                  at the original project. Pipelines using {unbundledRefCount !== 1 ? 'them' : 'it'}{' '}
                  may not work here.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
