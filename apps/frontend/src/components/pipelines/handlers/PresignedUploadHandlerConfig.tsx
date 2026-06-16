import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { PresignedUploadHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

export function PresignedUploadHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [subDir, setSubDir] = useState(typedConfig.subDir || '');
  const [filename, setFilename] = useState(typedConfig.filename || '');
  const [dateBucket, setDateBucket] = useState(typedConfig.dateBucket || false);
  const [expiresIn, setExpiresIn] = useState<number | undefined>(typedConfig.expiresIn);
  const [maxFileSize, setMaxFileSize] = useState<number | undefined>(typedConfig.maxFileSize);
  const [allowedMimeTypes, setAllowedMimeTypes] = useState(
    (typedConfig.allowedMimeTypes || []).join(', '),
  );

  useEffect(() => {
    onChange({
      subDir,
      filename: filename.trim() || undefined,
      dateBucket,
      ...(expiresIn !== undefined ? { expiresIn } : {}),
      ...(maxFileSize !== undefined ? { maxFileSize } : {}),
      allowedMimeTypes: allowedMimeTypes.trim()
        ? allowedMimeTypes.split(',').map((t) => t.trim())
        : undefined,
    });
  }, [subDir, filename, dateBucket, expiresIn, maxFileSize, allowedMimeTypes, onChange]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Direct-to-bucket upload (prepare step).</strong> Returns a presigned URL the
          client uploads to directly — the file never passes through the server. Pair this with a{' '}
          <strong>Register Upload</strong> step in a second pipeline the client calls after the
          upload completes. Requires S3, GCS, MinIO, or Azure storage (not local).
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
          Storage sub-directory for uploaded files. Supports expressions, e.g.{' '}
          <code>projects/{'{{request.body.projectId}}'}</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Filename</Label>
        <ExpressionInput
          value={filename}
          onChange={setFilename}
          placeholder="request.body.filename"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Expression resolving to the upload filename. Default: <code>request.body.filename</code>
        </p>
      </div>

      <div className="space-y-2">
        <Label>Expires In (seconds)</Label>
        <Input
          type="number"
          min={60}
          max={604800}
          value={expiresIn ?? ''}
          onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="3600"
        />
        <p className="text-xs text-muted-foreground">
          How long the upload URL is valid. Default: 3600 (1 hour).
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Date Bucketing</Label>
          <p className="text-xs text-muted-foreground">Organize files in YYYY-MM-DD folders</p>
        </div>
        <Switch checked={dateBucket} onCheckedChange={setDateBucket} />
      </div>

      <div className="space-y-2">
        <Label>Max File Size (bytes)</Label>
        <Input
          type="number"
          value={maxFileSize ?? ''}
          onChange={(e) => setMaxFileSize(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="e.g., 524288000 (500MB)"
        />
        <p className="text-xs text-muted-foreground">
          Hint returned to the client. Enforced at the Register Upload step.
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
          Comma-separated. Hint for the client; enforced at the Register Upload step.
        </p>
      </div>

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (return these to the client)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">uploadUrl</code>
          <span className="text-muted-foreground">Presigned URL — client PUTs the file here</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storageKey</code>
          <span className="text-muted-foreground">Pass back to the register step</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">publicPath</code>
          <span className="text-muted-foreground">Public serve URL once registered</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">originalName</code>
          <span className="text-muted-foreground">Resolved filename</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">expiresAt</code>
          <span className="text-muted-foreground">URL expiry (ISO 8601)</span>
        </div>
      </div>
    </div>
  );
}
