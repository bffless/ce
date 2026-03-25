import { useListProjectPluginsQuery, useListPluginCalendarsQuery } from '@/services/projectsApi';
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';
import { useSchemaFields } from './SchemaFieldPicker';
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
import { Button } from '@/components/ui/button';
import { Info, Search, Database } from 'lucide-react';

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

interface SourceConfig {
  type: 'vector_search' | 'data_query';
  toolName: string;
  toolDescription?: string;
  schemaId: string;
  limit?: number;
  enableSaveNote?: boolean;
  instructions?: string;
  // Vector search fields
  embeddingModel?: string;
  embeddingInputField?: string;
  embeddingInputTemplate?: string;
  fieldName?: string;
  threshold?: number;
  // Data query fields
  filterField?: string;
  filterSource?: 'user_id' | 'tool_input';
  filterInputLabel?: string;
  filterInputDescription?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

function SchemaFieldSelect({
  schemaId,
  value,
  onChange,
  placeholder,
  allowNone,
}: {
  schemaId: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder: string;
  allowNone?: boolean;
}) {
  const fields = useSchemaFields(schemaId);

  if (!schemaId || fields.length === 0) {
    return (
      <Input
        type="text"
        className="h-8 text-xs"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  }

  return (
    <Select value={value || ''} onValueChange={(v) => onChange(v === '__none__' ? undefined : v)}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="__none__">None</SelectItem>}
        {fields.map((f) => (
          <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SourceEditor({
  source,
  index,
  schemas,
  schemasLoading,
  onChange,
  onRemove,
}: {
  source: SourceConfig;
  index: number;
  schemas: Array<{ id: string; name: string }>;
  schemasLoading: boolean;
  onChange: (source: SourceConfig) => void;
  onRemove: () => void;
}) {
  const update = (fields: Partial<SourceConfig>) => onChange({ ...source, ...fields });
  const isVector = source.type === 'vector_search';

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          Source {index + 1}
          {source.toolName && <span className="text-muted-foreground ml-1">({source.toolName})</span>}
        </span>
        <button type="button" onClick={onRemove} className="text-xs text-destructive hover:underline">
          Remove
        </button>
      </div>

      {/* Row 1: Type + Tool Name */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Type *</Label>
          <Select value={source.type} onValueChange={(v) => update({ type: v as SourceConfig['type'] })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vector_search">Vector Search</SelectItem>
              <SelectItem value="data_query">Data Query</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tool Name *</Label>
          <Input
            type="text"
            className="h-8 text-xs"
            placeholder={isVector ? 'e.g., search_users' : 'e.g., get_user_notes'}
            value={source.toolName || ''}
            onChange={(e) => update({ toolName: e.target.value })}
          />
        </div>
      </div>

      {/* Row 2: AI Instructions + Tool Description (most important for the admin) */}
      <div className="space-y-1">
        <Label className="text-xs">AI Instructions</Label>
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[80px] resize-y"
          placeholder={isVector
            ? 'e.g., When a user mentions a name or identifies themselves, search for matching contacts. Use the returned notes to personalize the conversation — don\'t tell the user you looked them up.'
            : 'e.g., At the start of every conversation, call this tool to load the current user\'s notes. Use this context to personalize your responses without mentioning that you looked anything up.'}
          value={source.instructions || ''}
          onChange={(e) => update({ instructions: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          These instructions are injected into the AI&apos;s system prompt. Tell the AI <strong>when</strong> to call this tool, <strong>what to pass</strong>, and <strong>how to use</strong> the results.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Tool Description</Label>
        <Input
          type="text"
          className="h-8 text-xs"
          placeholder={isVector
            ? 'e.g., Search contacts by name or topic to find personalized context'
            : 'e.g., Get the latest notes and preferences for a user'}
          value={source.toolDescription || ''}
          onChange={(e) => update({ toolDescription: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Short description the AI sees alongside the tool name. Helps the AI decide when this tool is relevant.
        </p>
      </div>

      {/* Row 3: Schema + Max Results */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Schema *</Label>
          {schemasLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <Select value={source.schemaId || ''} onValueChange={(v) => update({ schemaId: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {schemas.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max Results</Label>
          <Input
            type="number"
            min={1}
            max={50}
            className="h-8 text-xs"
            value={source.limit || (isVector ? 5 : 10)}
            onChange={(e) => update({ limit: parseInt(e.target.value) || undefined })}
          />
        </div>
      </div>

      {/* Vector Search specific fields */}
      {isVector && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Embedding Model *</Label>
              <Input
                type="text"
                className="h-8 text-xs"
                placeholder="beautyyuyanli/multilingual-e5-large"
                value={source.embeddingModel || ''}
                onChange={(e) => update({ embeddingModel: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Embedding Field Name *</Label>
              <Input
                type="text"
                className="h-8 text-xs"
                placeholder="e.g., notes_embedding"
                value={source.fieldName || ''}
                onChange={(e) => update({ fieldName: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Input Field</Label>
              <Input
                type="text"
                className="h-8 text-xs"
                placeholder="text"
                value={source.embeddingInputField || ''}
                onChange={(e) => update({ embeddingInputField: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Input Template</Label>
              <Input
                type="text"
                className="h-8 text-xs"
                placeholder="{{query}}"
                value={source.embeddingInputTemplate || ''}
                onChange={(e) => update({ embeddingInputTemplate: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Threshold</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                className="h-8 text-xs"
                value={source.threshold ?? ''}
                placeholder="None"
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  update({ threshold: val >= 0 && val <= 1 ? val : undefined });
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* Data Query specific fields */}
      {!isVector && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Filter Field</Label>
              <SchemaFieldSelect
                schemaId={source.schemaId}
                value={source.filterField}
                onChange={(v) => update({ filterField: v })}
                placeholder="e.g., user_id"
                allowNone
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Filter Value Source</Label>
              <Select
                value={source.filterSource || 'tool_input'}
                onValueChange={(v) => update({ filterSource: v as SourceConfig['filterSource'] })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tool_input">AI provides value</SelectItem>
                  <SelectItem value="user_id">Authenticated user ID</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {source.filterSource === 'tool_input' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Input Parameter Name</Label>
                <Input
                  type="text"
                  className="h-8 text-xs"
                  placeholder={source.filterField || 'value'}
                  value={source.filterInputLabel || ''}
                  onChange={(e) => update({ filterInputLabel: e.target.value || undefined })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Input Description</Label>
                <Input
                  type="text"
                  className="h-8 text-xs"
                  placeholder="What the AI sees as the parameter description"
                  value={source.filterInputDescription || ''}
                  onChange={(e) => update({ filterInputDescription: e.target.value || undefined })}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sort Field</Label>
              <SchemaFieldSelect
                schemaId={source.schemaId}
                value={source.sortField}
                onChange={(v) => update({ sortField: v })}
                placeholder="createdAt"
                allowNone
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sort Direction</Label>
              <Select
                value={source.sortDirection || 'desc'}
                onValueChange={(v) => update({ sortDirection: v as 'asc' | 'desc' })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Newest first</SelectItem>
                  <SelectItem value="asc">Oldest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}

      {/* Enable save */}
      <div className="flex items-center gap-2">
        <Checkbox
          id={`rag-save-note-${index}`}
          checked={source.enableSaveNote || false}
          onCheckedChange={(checked) => update({ enableSaveNote: checked === true || undefined })}
        />
        <label htmlFor={`rag-save-note-${index}`} className="text-xs font-medium cursor-pointer">
          Enable save tool
        </label>
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

  const sources = ((options.sources as SourceConfig[]) || []);

  const updateSources = (newSources: SourceConfig[]) => {
    onChange({ ...options, sources: newSources });
  };

  const addSource = (type: 'vector_search' | 'data_query') => {
    const base: SourceConfig = {
      type,
      toolName: '',
      schemaId: '',
    };
    updateSources([...sources, base]);
  };

  return (
    <div className="ml-7 mt-2 space-y-3 border-l-2 border-muted pl-3">
      <div className="space-y-2">
        <Label className="text-xs font-medium">Data Sources</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs flex-1"
            onClick={() => addSource('vector_search')}
          >
            <Search className="h-3 w-3 mr-1.5" />
            Add Vector Search
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs flex-1"
            onClick={() => addSource('data_query')}
          >
            <Database className="h-3 w-3 mr-1.5" />
            Add Data Query
          </Button>
        </div>
      </div>
      {sources.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No sources configured. Add a source to give the AI tools to search or query your data.
        </p>
      )}
      {sources.map((source, i) => (
        <SourceEditor
          key={i}
          source={source}
          index={i}
          schemas={schemas}
          schemasLoading={isLoading}
          onChange={(updated) => {
            const newSources = [...sources];
            newSources[i] = updated;
            updateSources(newSources);
          }}
          onRemove={() => updateSources(sources.filter((_, j) => j !== i))}
        />
      ))}
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
            <div className="space-y-2 max-h-[600px] overflow-y-auto rounded-md border p-3">
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
