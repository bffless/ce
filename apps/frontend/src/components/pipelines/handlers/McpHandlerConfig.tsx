import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isRecord, summarizeMcpConfig } from './mcp-config-summary';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

/**
 * `mcp_handler` is authored as code (a rule set's YAML, or an app rendering it
 * from its tool catalog), not as a form: the config is the MCP server — its
 * tools, each mapped to a sibling rule, and its `ui://` resources. The panel
 * shows what the config declares and lets an operator edit the JSON directly;
 * a body that does not parse is reported and never sent.
 */
export function McpHandlerConfig({ config, onChange }: Props) {
  const [text, setText] = useState(() => JSON.stringify(config ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  // A config replaced from outside (another step selected, a reload) resets the editor.
  useEffect(() => {
    setText(JSON.stringify(config ?? {}, null, 2));
    setError(null);
  }, [config]);

  const summary = useMemo(() => summarizeMcpConfig(config ?? {}), [config]);

  const commit = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error('the config must be a JSON object');
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
          Each tool names a sibling rule of this alias (<code>rule.path</code>) that answers it
          in-process as the caller; resources map <code>ui://</code> URIs to sibling paths. This
          step is usually rendered from the app&apos;s own code and synced with{' '}
          <code>bffless rules push</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mcp-config-json">Configuration (JSON)</Label>
        <Textarea
          id="mcp-config-json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          spellCheck={false}
          className="font-mono text-xs min-h-[320px]"
        />
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            Not saved — {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            <code>serverInfo</code>, <code>instructions</code>, <code>tools[]</code> (
            <code>name</code>, <code>description</code>, <code>inputSchema</code>,{' '}
            <code>rule: {'{ path, method }'}</code>, optional <code>visibility</code>,{' '}
            <code>_meta</code>), <code>resources</code> (<code>static[]</code>,{' '}
            <code>templates[]</code>, <code>list.rule</code>, <code>csp</code>). Edits apply when
            the field loses focus.
          </p>
        )}
      </div>
    </div>
  );
}
