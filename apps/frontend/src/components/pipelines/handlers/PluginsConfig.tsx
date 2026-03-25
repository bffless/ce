import { useListProjectPluginsQuery, useListPluginCalendarsQuery } from '@/services/projectsApi';
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';
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
      <div className="space-y-1">
        <Label className="text-xs">Additional attendees</Label>
        <Input
          type="text"
          className="h-8 text-xs"
          placeholder="email1@example.com, email2@example.com"
          value={((options.additionalAttendees as string[]) || []).join(', ')}
          onChange={(e) => {
            const emails = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ ...options, additionalAttendees: emails.length ? emails : undefined });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated emails to always include on created events
        </p>
      </div>
    </div>
  );
}

function RagSearchOptions({
  projectId,
  options,
  onChange,
}: {
  projectId: string;
  options: Record<string, unknown>;
  onChange: (opts: Record<string, unknown>) => void;
}) {
  const { data: schemasData, isLoading } = useGetProjectSchemasQuery(projectId);
  const schemas = schemasData?.schemas || [];

  return (
    <div className="ml-7 mt-2 space-y-3 border-l-2 border-muted pl-3">
      <div className="space-y-1">
        <Label className="text-xs">Embedding Model</Label>
        <Input
          type="text"
          className="h-8 text-xs"
          placeholder="beautyyuyanli/multilingual-e5-large"
          value={(options.embeddingModel as string) || ''}
          onChange={(e) => onChange({ ...options, embeddingModel: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Replicate model for generating embeddings. Browse models at{' '}
          <a
            href="https://replicate.com/collections/embedding-models"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            replicate.com/collections/embedding-models
          </a>
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Input Field Name</Label>
        <Input
          type="text"
          className="h-8 text-xs w-40"
          placeholder="text"
          value={(options.embeddingInputField as string) || ''}
          onChange={(e) => onChange({ ...options, embeddingInputField: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          The model&apos;s input parameter name (default: &quot;text&quot;). Some models use &quot;texts&quot;, &quot;input&quot;, &quot;prompt&quot;, etc.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Input Value Template</Label>
        <Input
          type="text"
          className="h-8 text-xs"
          placeholder="{{query}}"
          value={(options.embeddingInputTemplate as string) || ''}
          onChange={(e) => onChange({ ...options, embeddingInputTemplate: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Use {'{{query}}'} as the placeholder for the search text. Default: {'{{query}}'}. For multilingual-e5-large use: [&quot;{'{{query}}'}&quot;]
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Schema</Label>
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : schemas.length > 0 ? (
          <Select
            value={(options.schemaId as string) || ''}
            onValueChange={(v) => onChange({ ...options, schemaId: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a schema..." />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((schema) => (
                <SelectItem key={schema.id} value={schema.id}>
                  {schema.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            No schemas found. Create a pipeline schema first.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The schema containing your data records with embeddings
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Embedding Field Name</Label>
        <Input
          type="text"
          className="h-8 text-xs"
          placeholder="e.g., notes_embedding"
          value={(options.fieldName as string) || ''}
          onChange={(e) => onChange({ ...options, fieldName: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Must match the fieldName used when storing embeddings via embed_store
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Max Results</Label>
        <Input
          type="number"
          min={1}
          max={50}
          className="h-8 text-xs w-24"
          value={(options.limit as number) || 5}
          onChange={(e) =>
            onChange({ ...options, limit: parseInt(e.target.value) || 5 })
          }
        />
        <p className="text-xs text-muted-foreground">
          Maximum number of results to return (1-50, default 5)
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Similarity Threshold</Label>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className="h-8 text-xs w-24"
          value={(options.threshold as number) ?? ''}
          placeholder="None"
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            onChange({ ...options, threshold: val >= 0 && val <= 1 ? val : undefined });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Minimum cosine similarity (0-1). Leave empty to return all results up to the limit.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="rag-enable-save-note"
          checked={(options.enableSaveNote as boolean) || false}
          onCheckedChange={(checked) =>
            onChange({ ...options, enableSaveNote: checked === true ? true : undefined })
          }
        />
        <div>
          <label htmlFor="rag-enable-save-note" className="text-xs font-medium cursor-pointer">
            Enable save_note tool
          </label>
          <p className="text-xs text-muted-foreground">
            Allow the AI to save new records and auto-generate embeddings for future retrieval
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

  const renderPluginOptions = (pluginId: string) => {
    if (pluginId === 'google-calendar') {
      return (
        <GoogleCalendarOptions
          projectId={projectId}
          options={getPluginOptions(pluginId)}
          onChange={(opts) => setPluginOptions(pluginId, opts)}
        />
      );
    }
    if (pluginId === 'rag-search') {
      return (
        <RagSearchOptions
          projectId={projectId}
          options={getPluginOptions(pluginId)}
          onChange={(opts) => setPluginOptions(pluginId, opts)}
        />
      );
    }
    return null;
  };

  // Plugins that have per-pipeline options
  const pluginsWithOptions = ['google-calendar', 'rag-search'];

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
                  {/* Per-plugin options when selected */}
                  {config.enabled?.includes(plugin.id) && renderPluginOptions(plugin.id)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Show per-plugin options for "all" mode too */}
      {config.mode === 'all' && !isLoading && enabledPlugins
        .filter((p) => pluginsWithOptions.includes(p.id))
        .map((plugin) => (
          <div key={plugin.id} className="space-y-2">
            <Label>{plugin.name} Options</Label>
            {renderPluginOptions(plugin.id)}
          </div>
        ))}

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
