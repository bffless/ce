import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2 } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker, useSchemaFields } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { FileUploadHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

// Fields that are always set by the handler — exclude from the field picker
const BUILT_IN_FIELDS = new Set([
  'filename', 'storage_path', 'content_type', 'size', 'url', 'sub_dir', 'original_name',
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

export function FileUploadHandlerConfig({ config, onChange, projectId, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [schemaId, setSchemaId] = useState(typedConfig.schemaId || '');
  const [subDir, setSubDir] = useState(typedConfig.subDir || '');
  const [dateBucket, setDateBucket] = useState(typedConfig.dateBucket || false);
  const [maxFileSize, setMaxFileSize] = useState<number | undefined>(typedConfig.maxFileSize);
  const [allowedMimeTypes, setAllowedMimeTypes] = useState(
    (typedConfig.allowedMimeTypes || []).join(', '),
  );
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
    });
  }, [schemaId, subDir, dateBucket, maxFileSize, allowedMimeTypes, fieldMappings, onChange]);

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
    setFieldMappings(
      fieldMappings.map((m, i) => (i === index ? { ...m, ...updates } : m)),
    );
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
        <Input
          value={subDir}
          onChange={(e) => setSubDir(e.target.value)}
          placeholder="e.g., images, documents"
        />
        <p className="text-xs text-muted-foreground">
          Storage sub-directory for uploaded files.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>Date Bucketing</Label>
          <p className="text-xs text-muted-foreground">
            Organize files in YYYY-MM-DD folders
          </p>
        </div>
        <Switch
          checked={dateBucket}
          onCheckedChange={setDateBucket}
        />
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

      {/* Extra Fields */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label>Extra Fields</Label>
            <p className="text-xs text-muted-foreground">
              Map additional form fields to schema fields. Built-in fields (filename, storage_path, etc.) are always included.
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
                      placeholder={schemaField ? getPlaceholderForType(schemaField.type) : 'request.body.fieldName'}
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
