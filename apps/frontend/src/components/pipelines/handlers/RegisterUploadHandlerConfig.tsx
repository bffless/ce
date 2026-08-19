import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SchemaPicker } from './SchemaPicker';
import { ExpressionInput } from './ExpressionInput';
import type { RegisterUploadHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

export function RegisterUploadHandlerConfig({
  config,
  onChange,
  projectId,
  previousSteps = [],
}: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [schemaId, setSchemaId] = useState(typedConfig.schemaId || '');
  const [subDir, setSubDir] = useState(typedConfig.subDir || '');
  const [storageKey, setStorageKey] = useState(typedConfig.storageKey || '');
  const [originalName, setOriginalName] = useState(typedConfig.originalName || '');
  const [maxFileSize, setMaxFileSize] = useState<number | undefined>(typedConfig.maxFileSize);
  const [allowedMimeTypes, setAllowedMimeTypes] = useState(
    (typedConfig.allowedMimeTypes || []).join(', '),
  );
  const [deleteOnViolation, setDeleteOnViolation] = useState(typedConfig.deleteOnViolation ?? true);

  useEffect(() => {
    onChange({
      schemaId,
      subDir,
      storageKey: storageKey.trim() || undefined,
      originalName: originalName.trim() || undefined,
      ...(maxFileSize !== undefined ? { maxFileSize } : {}),
      allowedMimeTypes: allowedMimeTypes.trim()
        ? allowedMimeTypes.split(',').map((t) => t.trim())
        : undefined,
      deleteOnViolation,
    });
  }, [
    schemaId,
    subDir,
    storageKey,
    originalName,
    maxFileSize,
    allowedMimeTypes,
    deleteOnViolation,
    onChange,
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Direct-to-bucket upload (finalize step).</strong> After the client uploads via the
          presigned URL, this verifies the file landed, reads its real size/type from storage, and
          writes the same metadata record a normal file upload would. Use the same Schema and
          Sub-directory as the matching <strong>Presigned Upload</strong> step.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Schema</Label>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={setSchemaId} />
        <p className="text-xs text-muted-foreground">
          Schema where the upload metadata record will be stored.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Sub-directory</Label>
        <ExpressionInput
          value={subDir}
          onChange={setSubDir}
          placeholder="e.g., images or projects/{{request.body.projectId}}"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Must match the Presigned Upload step. Supports expressions, e.g.{' '}
          <code>projects/{'{{request.body.projectId}}'}</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Storage Key</Label>
        <ExpressionInput
          value={storageKey}
          onChange={setStorageKey}
          placeholder="request.body.storageKey"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Expression resolving to the <code>storageKey</code> from the prepare step. Default:{' '}
          <code>request.body.storageKey</code>
        </p>
      </div>

      <div className="space-y-2">
        <Label>Original Name</Label>
        <ExpressionInput
          value={originalName}
          onChange={setOriginalName}
          placeholder="request.body.originalName"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Expression for the display filename. Default: <code>request.body.originalName</code>
        </p>
      </div>

      <div className="space-y-2">
        <Label>Max File Size (bytes)</Label>
        <Input
          type="number"
          value={maxFileSize ?? ''}
          onChange={(e) => setMaxFileSize(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="524288000 (500MB)"
        />
        <p className="text-xs text-muted-foreground">
          Enforced against the actual uploaded object. Default: 500MB.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Allowed MIME Types</Label>
        <Input
          value={allowedMimeTypes}
          onChange={(e) => setAllowedMimeTypes(e.target.value)}
          placeholder="e.g., image/*, application/pdf"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Enforced when storage reports the object's content-type.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Delete On Violation</Label>
          <p className="text-xs text-muted-foreground">
            Remove the uploaded object if it fails size/type checks
          </p>
        </div>
        <Switch checked={deleteOnViolation} onCheckedChange={setDeleteOnViolation} />
      </div>

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">id</code>
          <span className="text-muted-foreground">Record ID</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">url</code>
          <span className="text-muted-foreground">Public serve URL</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storage_path</code>
          <span className="text-muted-foreground">Full storage key</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">content_type</code>
          <span className="text-muted-foreground">MIME type</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">size</code>
          <span className="text-muted-foreground">File size in bytes</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">original_name</code>
          <span className="text-muted-foreground">Original upload name</span>
        </div>
      </div>
    </div>
  );
}
