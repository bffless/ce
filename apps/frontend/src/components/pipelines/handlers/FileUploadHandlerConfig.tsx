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
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';
import type { FileUploadHandlerConfig as Config } from './types';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  projectId: string;
}

export function FileUploadHandlerConfig({ config, onChange, projectId }: Props) {
  const typedConfig = config as unknown as Partial<Config>;
  const { data: schemasData } = useGetProjectSchemasQuery(projectId);

  const update = (partial: Partial<Config>) => {
    onChange({ ...typedConfig, ...partial } as Config);
  };

  const extraFields = typedConfig.extraFields || {};
  const extraFieldEntries = Object.entries(extraFields);

  const addExtraField = () => {
    update({ extraFields: { ...extraFields, '': '' } });
  };

  const updateExtraFieldKey = (oldKey: string, newKey: string) => {
    const newFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(extraFields)) {
      if (k === oldKey) {
        newFields[newKey] = v;
      } else {
        newFields[k] = v;
      }
    }
    update({ extraFields: newFields });
  };

  const updateExtraFieldValue = (key: string, value: string) => {
    update({ extraFields: { ...extraFields, [key]: value } });
  };

  const removeExtraField = (key: string) => {
    const newFields = { ...extraFields };
    delete newFields[key];
    update({ extraFields: Object.keys(newFields).length > 0 ? newFields : undefined });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Schema</Label>
        <Select
          value={typedConfig.schemaId || ''}
          onValueChange={(value) => update({ schemaId: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a schema for metadata records" />
          </SelectTrigger>
          <SelectContent>
            {schemasData?.schemas?.map((schema) => (
              <SelectItem key={schema.id} value={schema.id}>
                {schema.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Schema where upload metadata records will be stored.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Sub-directory</Label>
        <Input
          value={typedConfig.subDir || ''}
          onChange={(e) => update({ subDir: e.target.value })}
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
          checked={typedConfig.dateBucket || false}
          onCheckedChange={(checked) => update({ dateBucket: checked })}
        />
      </div>

      <div className="space-y-2">
        <Label>Max File Size (bytes)</Label>
        <Input
          type="number"
          value={typedConfig.maxFileSize || ''}
          onChange={(e) => update({ maxFileSize: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="10485760 (10MB)"
        />
      </div>

      <div className="space-y-2">
        <Label>Allowed MIME Types</Label>
        <Input
          value={(typedConfig.allowedMimeTypes || []).join(', ')}
          onChange={(e) =>
            update({
              allowedMimeTypes: e.target.value
                ? e.target.value.split(',').map((t) => t.trim())
                : undefined,
            })
          }
          placeholder='e.g., image/*, application/pdf'
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
          <Button type="button" variant="ghost" size="sm" onClick={addExtraField}>
            <Plus className="h-3 w-3 mr-1" />
            Add Field
          </Button>
        </div>
        {extraFieldEntries.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
              <span>Schema Field</span>
              <span>Expression</span>
              <span></span>
            </div>
            {extraFieldEntries.map(([key, value], index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  value={key}
                  onChange={(e) => updateExtraFieldKey(key, e.target.value)}
                  placeholder="e.g., description"
                  className="text-sm"
                />
                <Input
                  value={value}
                  onChange={(e) => updateExtraFieldValue(key, e.target.value)}
                  placeholder="e.g., request.body.description"
                  className="text-sm font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeExtraField(key)}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
