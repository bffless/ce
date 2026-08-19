import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker, useSchemaFields } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { FileUploadHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

// Fields that are always set by the handler — exclude from the field picker
const BUILT_IN_FIELDS = new Set([
  'filename',
  'storage_path',
  'content_type',
  'size',
  'url',
  'sub_dir',
  'original_name',
]);

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FieldMapping {
  schemaField: string;
  expression: string;
}

export function FileUploadHandlerConfig({
  config,
  onChange,
  projectId,
  previousSteps = [],
}: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [schemaId, setSchemaId] = useState(typedConfig.schemaId || '');
  const [subDir, setSubDir] = useState(typedConfig.subDir || '');
  const [dateBucket, setDateBucket] = useState(typedConfig.dateBucket || false);
  const [maxFileSize, setMaxFileSize] = useState<number | undefined>(typedConfig.maxFileSize);
  const [allowedMimeTypes, setAllowedMimeTypes] = useState(
    (typedConfig.allowedMimeTypes || []).join(', '),
  );
  const [fileField, setFileField] = useState(typedConfig.fileField || '');
  const [sourceUrl, setSourceUrl] = useState(typedConfig.sourceUrl || '');
  const [filename, setFilename] = useState(typedConfig.filename || '');
  const [convertTo, setConvertTo] = useState<string>(typedConfig.convertTo || 'none');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(() => {
    const existing = typedConfig.extraFields || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([schemaField, expression]) => ({ schemaField, expression }))
      : [];
  });

  const schemaFields = useSchemaFields(schemaId);

  // Filter out built-in fields from schema fields for the picker
  const extraSchemaFields = useMemo(
    () => schemaFields.filter((f) => !BUILT_IN_FIELDS.has(f.name)),
    [schemaFields],
  );

  const usedFields = useMemo(
    () => [
      ...Array.from(BUILT_IN_FIELDS),
      ...fieldMappings.map((m) => m.schemaField).filter(Boolean),
    ],
    [fieldMappings],
  );

  // Emit config changes
  useEffect(() => {
    const extraFields: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      if (mapping.schemaField.trim()) {
        extraFields[mapping.schemaField.trim()] = mapping.expression;
      }
    }

    onChange({
      schemaId,
      subDir,
      dateBucket,
      maxFileSize,
      allowedMimeTypes: allowedMimeTypes.trim()
        ? allowedMimeTypes.split(',').map((t) => t.trim())
        : undefined,
      extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
      fileField: fileField.trim() || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      filename: filename.trim() || undefined,
      convertTo: convertTo !== 'none' ? (convertTo as 'png' | 'jpeg' | 'webp') : undefined,
    });
  }, [
    schemaId,
    subDir,
    dateBucket,
    maxFileSize,
    allowedMimeTypes,
    fileField,
    sourceUrl,
    filename,
    convertTo,
    fieldMappings,
    onChange,
  ]);

  const handleSchemaChange = (newSchemaId: string) => {
    setSchemaId(newSchemaId);
    setFieldMappings([]);
  };

  const handleAddMapping = () => {
    setFieldMappings([...fieldMappings, { schemaField: '', expression: '' }]);
  };

  const handleRemoveMapping = (index: number) => {
    setFieldMappings(fieldMappings.filter((_, i) => i !== index));
  };

  const handleMappingChange = (index: number, updates: Partial<FieldMapping>) => {
    setFieldMappings(fieldMappings.map((m, i) => (i === index ? { ...m, ...updates } : m)));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Schema</Label>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={handleSchemaChange} />
        <p className="text-xs text-muted-foreground">
          Schema where upload metadata records will be stored.
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
          Storage sub-directory for uploaded files. Supports expressions for per-project layouts,
          e.g. <code>projects/{'{{request.body.projectId}}'}</code>.
        </p>
      </div>

      {/* Source URL — download from URL instead of multipart */}
      <div className="space-y-2">
        <Label>Source URL (optional)</Label>
        <ExpressionInput
          value={sourceUrl}
          onChange={setSourceUrl}
          placeholder="e.g., steps.replicate_ai.output"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Download a file from a URL instead of reading from a multipart form upload. Use an
          expression to reference a URL from a previous step (e.g., a Replicate AI output).
          {sourceUrl && ' File Field Name below is ignored when Source URL is set.'}
        </p>
      </div>

      {/* Filename override */}
      <div className="space-y-2">
        <Label>Filename Override (optional)</Label>
        <ExpressionInput
          value={filename}
          onChange={setFilename}
          placeholder="e.g., request.body.name"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Override the stored filename. Supports expressions. The original file extension is
          preserved if not included in the override.
        </p>
      </div>

      {/* Image format conversion */}
      <div className="space-y-2">
        <Label>Convert Image Format (optional)</Label>
        <Select value={convertTo} onValueChange={setConvertTo}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No conversion</SelectItem>
            <SelectItem value="png">PNG</SelectItem>
            <SelectItem value="jpeg">JPEG</SelectItem>
            <SelectItem value="webp">WebP</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Convert uploaded images to a different format (e.g., HEIC to PNG). Non-image files pass
          through unchanged.
        </p>
      </div>

      {!sourceUrl && (
        <div className="space-y-2">
          <Label>File Field Name</Label>
          <Input
            value={fileField}
            onChange={(e) => setFileField(e.target.value)}
            placeholder="file"
          />
          <p className="text-xs text-muted-foreground">
            The multipart form field name for the uploaded file. Default: <code>file</code>
          </p>
        </div>
      )}

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
          placeholder="10485760 (10MB)"
        />
      </div>

      <div className="space-y-2">
        <Label>Allowed MIME Types</Label>
        <Input
          value={allowedMimeTypes}
          onChange={(e) => setAllowedMimeTypes(e.target.value)}
          placeholder="e.g., image/*, application/pdf"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Leave empty to allow all file types.
        </p>
      </div>

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storage_path</code>
          <span className="text-muted-foreground">Full storage key</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">url</code>
          <span className="text-muted-foreground">Internal API URL</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">content_type</code>
          <span className="text-muted-foreground">MIME type (e.g., image/png)</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">filename</code>
          <span className="text-muted-foreground">Sanitized filename</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">size</code>
          <span className="text-muted-foreground">File size in bytes</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">original_name</code>
          <span className="text-muted-foreground">Original upload name</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">id</code>
          <span className="text-muted-foreground">Record ID</span>
        </div>
      </div>

      {/* Extra Fields */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label>Extra Fields</Label>
            <p className="text-xs text-muted-foreground">
              Map additional form fields to schema fields. Built-in fields (filename, storage_path,
              etc.) are always included.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddMapping}
            disabled={extraSchemaFields.length === 0 && !schemaId}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Field
          </Button>
        </div>

        {fieldMappings.length > 0 && (
          <div className="space-y-2">
            {fieldMappings.map((mapping, index) => {
              const schemaField = schemaFields.find((f) => f.name === mapping.schemaField);

              return (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1">
                    <SchemaFieldPicker
                      schemaId={schemaId}
                      value={mapping.schemaField}
                      onChange={(value) => handleMappingChange(index, { schemaField: value })}
                      usedFields={usedFields}
                      placeholder="Select field"
                    />
                  </div>
                  <span className="text-muted-foreground">=</span>
                  <div className="flex-1">
                    <ExpressionInput
                      value={mapping.expression}
                      onChange={(value) => handleMappingChange(index, { expression: value })}
                      placeholder={
                        schemaField
                          ? getPlaceholderForType(schemaField.type)
                          : 'request.body.fieldName'
                      }
                      previousSteps={previousSteps}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMapping(index)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function getPlaceholderForType(type: string): string {
  switch (type) {
    case 'number':
      return 'request.body.quantity or 42';
    case 'boolean':
      return 'request.body.enabled or true';
    case 'email':
      return 'request.body.email or user.email';
    case 'datetime':
      return 'now() or request.body.date';
    case 'json':
      return 'request.body.metadata or {}';
    default:
      return 'request.body.fieldName';
  }
}
