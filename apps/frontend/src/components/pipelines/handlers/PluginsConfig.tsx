import { useListProjectPluginsQuery, useListPluginCalendarsQuery } from '@/services/projectsApi';
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
import { Input } from '@/components/ui/input';
import { Info } from 'lucide-react';

export interface PluginsConfigValue {
  mode: 'none' | 'all' | 'selected';
  enabled?: string[];
  options?: Record<string, Record<string, unknown>>;
}

interface PluginsConfigProps {
  config: PluginsConfigValue;
  onChange: (config: PluginsConfigValue) => void;
  projectId: string;
}

function GoogleCalendarOptions({
  projectId,
  options,
  onChange,
}: {
  projectId: string;
  options: Record<string, unknown>;
  onChange: (opts: Record<string, unknown>) => void;
}) {
  const { data: calendarsData, isLoading, isError } = useListPluginCalendarsQuery(projectId);
  const calendars = calendarsData?.calendars || [];

  return (
    <div className="ml-7 mt-2 space-y-3 border-l-2 border-muted pl-3">
      <div className="space-y-1">
        <Label className="text-xs">Calendar</Label>
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : isError ? (
          <p className="text-xs text-muted-foreground">
            Could not load calendars. Ensure the Google Calendar API is enabled in your GCP project.
          </p>
        ) : calendars.length > 0 ? (
          <Select
            value={(options.calendarId as string) || 'primary'}
            onValueChange={(v) => onChange({ ...options, calendarId: v === 'primary' ? undefined : v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Primary calendar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Primary calendar</SelectItem>
              {calendars
                .filter((c) => !c.primary)
                .map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    {cal.summary}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            Connect a Google account in project settings to select a calendar.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Look-ahead days</Label>
        <Input
          type="number"
          min={1}
          max={90}
          className="h-8 text-xs w-24"
          value={(options.lookAheadDays as number) || 7}
          onChange={(e) =>
            onChange({ ...options, lookAheadDays: parseInt(e.target.value) || 7 })
          }
        />
        <p className="text-xs text-muted-foreground">
          Default days to look ahead for availability (1-90)
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Max slots</Label>
        <Input
          type="number"
          min={1}
          max={20}
          className="h-8 text-xs w-24"
          value={(options.maxSlots as number) || ''}
          placeholder="All"
          onChange={(e) => {
            const val = parseInt(e.target.value);
            onChange({ ...options, maxSlots: val > 0 ? val : undefined });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Maximum free slots to return (leave empty for all)
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="add-google-meet"
          checked={(options.addGoogleMeet as boolean) || false}
          onCheckedChange={(checked) =>
            onChange({ ...options, addGoogleMeet: checked === true ? true : undefined })
          }
        />
        <div>
          <label htmlFor="add-google-meet" className="text-xs font-medium cursor-pointer">
            Add Google Meet link
          </label>
          <p className="text-xs text-muted-foreground">
            Automatically attach a Google Meet video conference to created events
          </p>
        </div>
      </div>
    </div>
  );
}

export function PluginsConfig({ config, onChange, projectId }: PluginsConfigProps) {
  const { data: plugins, isLoading } = useListProjectPluginsQuery(projectId);
  // Only show plugins that are enabled at the project level
  const enabledPlugins = (plugins ?? []).filter((p) => p.enabled);

  const getPluginOptions = (pluginId: string): Record<string, unknown> => {
    return config.options?.[pluginId] || {};
  };

  const setPluginOptions = (pluginId: string, opts: Record<string, unknown>) => {
    onChange({
      ...config,
      options: { ...(config.options || {}), [pluginId]: opts },
    });
  };

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
            <div className="space-y-2 max-h-64 overflow-y-auto rounded-md border p-3">
              {enabledPlugins.map((plugin) => (
                <div key={plugin.id}>
                  <div className="flex items-start gap-3">
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
                  {/* Per-plugin options for Google Calendar */}
                  {plugin.id === 'google-calendar' &&
                    config.enabled?.includes(plugin.id) && (
                      <GoogleCalendarOptions
                        projectId={projectId}
                        options={getPluginOptions(plugin.id)}
                        onChange={(opts) => setPluginOptions(plugin.id, opts)}
                      />
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Show per-plugin options for "all" mode too */}
      {config.mode === 'all' && !isLoading && enabledPlugins.some((p) => p.id === 'google-calendar') && (
        <div className="space-y-2">
          <Label>Google Calendar Options</Label>
          <GoogleCalendarOptions
            projectId={projectId}
            options={getPluginOptions('google-calendar')}
            onChange={(opts) => setPluginOptions('google-calendar', opts)}
          />
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
