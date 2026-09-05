import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { summarizeMcpConfig } from './mcp-config-summary';
import { JsonField } from './mcp/JsonField';
import { McpServerSection } from './mcp/McpServerSection';
import { McpToolList } from './mcp/McpToolList';
import { McpResourcesSection } from './mcp/McpResourcesSection';
import { normalize, serialize, validate, type McpConfig } from './mcp/model';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /** The rule set whose rules answer the tools; defaults to the route's `:ruleSetId`. */
  ruleSetId?: string;
  /** The rule being edited; defaults to the route's `:ruleId`. */
  ruleId?: string;
}

type TabKey = 'server' | 'tools' | 'resources' | 'json';

/**
 * `mcp_handler`: the step *is* the MCP server. Its config declares the server
 * (`serverInfo`, `instructions`), the tools — each answered by a sibling rule
 * of the same alias, run in-process as the caller — and the `ui://` resources
 * an MCP App host can read. Edited as a form (Server / Tools / Resources) or,
 * for copying into rules-as-code, as JSON. The form writes the same shape the
 * backend validates; keys it does not model are carried through untouched.
 */
export function McpHandlerConfig({ config, onChange, ruleSetId, ruleId }: Props) {
  const params = useParams<{ ruleSetId?: string; ruleId?: string }>();
  const setId = ruleSetId ?? params.ruleSetId;
  const excludeRuleId = ruleId ?? params.ruleId;

  const [tab, setTab] = useState<TabKey>('server');

  const model = useMemo(() => normalize(config ?? {}), [config]);
  const serialized = useMemo(() => serialize(model), [model]);
  const problems = useMemo(() => validate(model), [model]);
  const summary = useMemo(() => summarizeMcpConfig(serialized), [serialized]);

  const emit = (next: McpConfig) => onChange(serialize(next));
  const patch = (p: Partial<McpConfig>) => emit({ ...model, ...p });

  const serverInfoError = problems.find((p) => p.path[0] === 'serverInfo')?.message;
  const staticResourceUris = model.resources.static.map((r) => r.uri).filter(Boolean);
  const toolProblems = problems.filter((p) => p.path[0] === 'tools').length;
  const resourceProblems = problems.filter((p) => p.path[0] === 'resources').length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
        <p className="font-medium text-muted-foreground">
          MCP server{summary.server ? `: ${summary.server}` : ''}
        </p>
        <p className="text-muted-foreground" data-testid="mcp-summary">
          {summary.tools.length} tool{summary.tools.length === 1 ? '' : 's'}
          {summary.tools.length ? ` (${summary.tools.join(', ')})` : ''} · {summary.staticResources}{' '}
          static resource{summary.staticResources === 1 ? '' : 's'} · {summary.templates} resource
          template{summary.templates === 1 ? '' : 's'}
        </p>
        <p className="text-muted-foreground">
          This step answers as a stateless MCP server. Each tool names a sibling rule of this alias
          (its path and method) that runs it in-process as the caller, with that rule&apos;s own
          auth; resources map <code>ui://</code> URIs to sibling paths. The JSON tab holds the same
          config for <code>bffless rules push</code>.
        </p>
      </div>

      {problems.length > 0 && (
        <Alert variant="destructive" data-testid="mcp-problems">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {problems.length === 1 ? 'One thing' : `${problems.length} things`} the server would
            refuse at run time
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              {problems.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() =>
                      setTab(
                        p.path[0] === 'tools'
                          ? 'tools'
                          : p.path[0] === 'resources'
                            ? 'resources'
                            : 'server',
                      )
                    }
                  >
                    {p.message}
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="server">
            Server
            {serverInfoError && <ProblemDot count={1} />}
          </TabsTrigger>
          <TabsTrigger value="tools">
            Tools
            <span className="ml-1 text-xs text-muted-foreground">{model.tools.length}</span>
            {toolProblems > 0 && <ProblemDot count={toolProblems} />}
          </TabsTrigger>
          <TabsTrigger value="resources">
            Resources
            <span className="ml-1 text-xs text-muted-foreground">
              {model.resources.static.length + model.resources.templates.length}
            </span>
            {resourceProblems > 0 && <ProblemDot count={resourceProblems} />}
          </TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="pt-2">
          <McpServerSection config={model} onChange={patch} serverInfoError={serverInfoError} />
        </TabsContent>

        <TabsContent value="tools" className="pt-2">
          <McpToolList
            tools={model.tools}
            onChange={(tools) => patch({ tools })}
            staticResourceUris={staticResourceUris}
            problems={problems}
            ruleSetId={setId}
            excludeRuleId={excludeRuleId}
          />
        </TabsContent>

        <TabsContent value="resources" className="pt-2">
          <McpResourcesSection
            resources={model.resources}
            onChange={(resources) => patch({ resources })}
            problems={problems}
            ruleSetId={setId}
            excludeRuleId={excludeRuleId}
          />
        </TabsContent>

        <TabsContent value="json" className="pt-2">
          <JsonField
            label="Configuration (JSON)"
            value={serialized}
            onChange={onChange}
            minHeightClass="min-h-[420px]"
            help="The whole step config — what rules-as-code carries under the step's `config`. Edits apply when the field loses focus."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProblemDot({ count }: { count: number }) {
  return (
    <span
      role="img"
      aria-label={`${count} problem${count === 1 ? '' : 's'}`}
      className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive"
    />
  );
}
