import { useListProjectPluginsQuery } from '@/services/projectsApi';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Info } from 'lucide-react';

export interface PluginsConfigValue {
  mode: 'none' | 'all' | 'selected';
  enabled?: string[];
}

interface PluginsConfigProps {
  config: PluginsConfigValue;
  onChange: (config: PluginsConfigValue) => void;
  projectId: string;
}

export function PluginsConfig({ config, onChange, projectId }: PluginsConfigProps) {
  const { data: plugins, isLoading } = useListProjectPluginsQuery(projectId);
  // Only show plugins that are enabled at the project level
  const enabledPlugins = (plugins ?? []).filter((p) => p.enabled);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Plugins Mode</Label>
        <Select
          value={config.mode}
          onValueChange={(v) =>
            onChange({ ...config, mode: v as PluginsConfigValue['mode'] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Disabled</SelectItem>
            <SelectItem value="all">Enable All Plugins</SelectItem>
            <SelectItem value="selected">Select Plugins</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {config.mode === 'none' && 'Plugins are disabled for this handler.'}
          {config.mode === 'all' && 'All project-enabled plugins will be available.'}
          {config.mode === 'selected' && 'Choose specific plugins to enable for this handler.'}
        </p>
      </div>

      {config.mode === 'selected' && (
        <div className="space-y-2">
          <Label>Enabled Plugins</Label>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : enabledPlugins.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No plugins are enabled at the project level. Enable plugins in{' '}
                <strong>Project Settings &gt; AI</strong> first.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
              {enabledPlugins.map((plugin) => (
                <div key={plugin.id} className="flex items-start gap-3">
                  <Checkbox
                    id={`plugin-${plugin.id}`}
                    checked={config.enabled?.includes(plugin.id) ?? false}
                    onCheckedChange={(checked) => {
                      const current = config.enabled ?? [];
                      onChange({
                        ...config,
                        enabled: checked
                          ? [...current, plugin.id]
                          : current.filter((id) => id !== plugin.id),
                      });
                    }}
                  />
                  <div className="flex-1 leading-none">
                    <label
                      htmlFor={`plugin-${plugin.id}`}
                      className="font-medium text-sm cursor-pointer"
                    >
                      {plugin.name}
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {plugin.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {config.mode !== 'none' && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-xs">
            When plugins are enabled, the AI can use plugin tools to perform actions like calculations,
            web searches, and more. Only plugins enabled at the project level are available.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
