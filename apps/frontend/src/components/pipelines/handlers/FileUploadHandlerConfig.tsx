import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    </div>
  );
}
