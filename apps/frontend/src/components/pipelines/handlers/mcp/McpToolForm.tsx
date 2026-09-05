import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InputSchemaEditor } from './InputSchemaEditor';
import { SiblingRulePicker } from './SiblingRulePicker';
import { isRecord, type McpMethod, type McpTool } from './model';

/** The MCP tool annotations (spec "ToolAnnotations") a client uses to decide how carefully to call. */
const HINTS: { key: string; label: string; help: string }[] = [
  { key: 'readOnlyHint', label: 'Read-only', help: 'The tool changes nothing.' },
  {
    key: 'destructiveHint',
    label: 'Destructive',
    help: 'It may delete or irreversibly change data.',
  },
  {
    key: 'idempotentHint',
    label: 'Idempotent',
    help: 'Calling it again with the same arguments changes nothing more.',
  },
  {
    key: 'openWorldHint',
    label: 'Open world',
    help: 'It reaches outside this server (the web, third parties).',
  },
];

interface McpToolFormProps {
  tool: McpTool;
  onChange: (tool: McpTool) => void;
  /** Declared `resources.static[].uri` values, offered for `_meta.ui.resourceUri`. */
  staticResourceUris: string[];
  ruleSetId?: string;
  excludeRuleId?: string;
  nameError?: string;
}

export function McpToolForm({
  tool,
  onChange,
  staticResourceUris,
  ruleSetId,
  excludeRuleId,
  nameError,
}: McpToolFormProps) {
  const id = useId();
  const patch = (p: Partial<McpTool>) => onChange({ ...tool, ...p });

  const setHint = (key: string, on: boolean) => {
    const annotations = { ...tool.annotations };
    if (on) annotations[key] = true;
    else delete annotations[key];
    patch({ annotations });
  };

  const ui = isRecord(tool._meta.ui) ? tool._meta.ui : {};
  const resourceUri = typeof ui.resourceUri === 'string' ? ui.resourceUri : '';
  const setResourceUri = (value: string) => {
    const nextUi = { ...ui };
    if (value) nextUi.resourceUri = value;
    else delete nextUi.resourceUri;
    const meta = { ...tool._meta };
    if (Object.keys(nextUi).length) meta.ui = nextUi;
    else delete meta.ui;
    patch({ _meta: meta });
  };

  const appOnly = tool.visibility.includes('app');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>Tool name</Label>
          <Input
            id={`${id}-name`}
            value={tool.name}
            placeholder="workflow.list"
            onChange={(e) => patch({ name: e.target.value })}
            className="font-mono text-sm"
            aria-invalid={nameError ? true : undefined}
          />
          {nameError ? (
            <p className="text-xs text-destructive">{nameError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              What the client calls. Dots group tools (<code>workflow.list</code>).
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input
            id={`${id}-title`}
            value={typeof tool.annotations.title === 'string' ? tool.annotations.title : ''}
            placeholder="Optional human-readable title"
            onChange={(e) => {
              const annotations = { ...tool.annotations };
              if (e.target.value) annotations.title = e.target.value;
              else delete annotations.title;
              patch({ annotations });
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          id={`${id}-description`}
          value={tool.description}
          placeholder="What the tool does and when a model should call it."
          onChange={(e) => patch({ description: e.target.value })}
          className="min-h-[72px] text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <SiblingRulePicker
          label="Answered by rule"
          value={tool.rule.path}
          method={tool.rule.method ?? 'POST'}
          ruleSetId={ruleSetId}
          excludeRuleId={excludeRuleId}
          onChange={(path) => patch({ rule: { ...tool.rule, path } })}
          help="The sibling rule of this alias that runs the tool, in-process as the caller. Its own auth validators apply."
        />
        <div className="space-y-2">
          <Label htmlFor={`${id}-method`}>Method</Label>
          <Select
            value={tool.rule.method ?? 'POST'}
            onValueChange={(m) => patch({ rule: { ...tool.rule, method: m as McpMethod } })}
          >
            <SelectTrigger id={`${id}-method`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Arguments go as the JSON body (POST) or the query (GET).
          </p>
        </div>
      </div>

      <InputSchemaEditor
        value={tool.inputSchema}
        onChange={(inputSchema) => patch({ inputSchema })}
      />

      <div className="space-y-2">
        <Label>Hints for the client</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {HINTS.map((h) => (
            <label key={h.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <Switch
                checked={tool.annotations[h.key] === true}
                onCheckedChange={(on) => setHint(h.key, on)}
                aria-label={`${h.label} (${h.key})`}
              />
              <span className="min-w-0">
                <span className="block font-medium">{h.label}</span>
                <span className="block text-xs text-muted-foreground">{h.help}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-visibility`}>Visible to</Label>
          <Select
            value={appOnly ? 'app' : 'model'}
            onValueChange={(v) => patch({ visibility: v === 'app' ? ['app'] : [] })}
          >
            <SelectTrigger id={`${id}-visibility`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="model">Model (default)</SelectItem>
              <SelectItem value="app">App only</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            App-only tools are listed with <code>_meta.ui.visibility</code> for an MCP App&apos;s
            own UI to call; a model does not see them.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-ui`}>UI resource</Label>
          <Input
            id={`${id}-ui`}
            list={`${id}-ui-options`}
            value={resourceUri}
            placeholder="ui://… (optional)"
            onChange={(e) => setResourceUri(e.target.value)}
            className="font-mono text-sm"
          />
          <datalist id={`${id}-ui-options`}>
            {staticResourceUris.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            <code>_meta.ui.resourceUri</code>: the static resource a host renders for this tool (MCP
            Apps).
          </p>
        </div>
      </div>
    </div>
  );
}
