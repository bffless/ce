import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FileServeHandlerConfig as Config } from './types';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
}

export function FileServeHandlerConfig({ config, onChange }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const update = (partial: Partial<Config>) => {
    onChange({ ...typedConfig, ...partial } as Config);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Sub-directory</Label>
        <Input
          value={typedConfig.subDir || ''}
          onChange={(e) => update({ subDir: e.target.value })}
          placeholder="e.g., images, documents"
        />
        <p className="text-xs text-muted-foreground">
          Storage sub-directory to serve files from.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Cache Max-Age (seconds)</Label>
        <Input
          type="number"
          value={typedConfig.cacheMaxAge ?? ''}
          onChange={(e) => update({ cacheMaxAge: e.target.value ? Number(e.target.value) : undefined })}
          placeholder="3600"
        />
        <p className="text-xs text-muted-foreground">
          Cache-Control max-age header value. Default: 3600 (1 hour).
        </p>
      </div>
    </div>
  );
}
