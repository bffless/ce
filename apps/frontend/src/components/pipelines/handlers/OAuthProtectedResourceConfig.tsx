import { useId, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGetRuleSetRulesQuery } from '@/services/proxyRulesApi';
import { StringListInput } from './mcp/StringListInput';
import {
  PROTECTED_RESOURCE_PATH,
  answersWellKnown,
  deriveScopes,
  findMcpRule,
  type DiscoveryRule,
} from './mcp/discovery';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /** The rule set the MCP rule lives in; defaults to the route's `:ruleSetId`. */
  ruleSetId?: string;
  /** The rule being edited; defaults to the route's `:ruleId`. */
  ruleId?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * `oauth_protected_resource`: the RFC 9728 document for the `mcp_handler` at
 * `resource`, derived at request time — `resource` from the host,
 * `authorization_servers` from this instance's issuer, `scopes_supported` from
 * the MCP rule's siblings unless declared here. The form shows what the
 * document will say, read off the rule set as the backend reads it.
 */
export function OAuthProtectedResourceConfig({ config, onChange, ruleSetId, ruleId }: Props) {
  const id = useId();
  const params = useParams<{ ruleSetId?: string; ruleId?: string }>();
  const setId = ruleSetId ?? params.ruleSetId;
  const ownRuleId = ruleId ?? params.ruleId;
  const { data } = useGetRuleSetRulesQuery(setId ?? '', { skip: !setId });
  const rules = (data?.rules ?? []) as unknown as DiscoveryRule[];

  const resource = str(config.resource);
  const declared = Array.isArray(config.scopes);
  const scopes = strList(config.scopes);

  const mcp = useMemo(() => findMcpRule(rules, resource), [rules, resource]);
  const derived = useMemo(() => (mcp ? deriveScopes(rules, mcp.tools) : []), [rules, mcp]);
  const ownRule = rules.find((r) => r.id === ownRuleId);
  const pathWarning = ownRule && !answersWellKnown(ownRule);

  const patch = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...config, ...p };
    for (const key of Object.keys(p)) if (p[key] === undefined) delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
        <p className="font-medium">OAuth discovery for an MCP server (RFC 9728)</p>
        <p>
          Answers <code>GET {PROTECTED_RESOURCE_PATH}</code> (and the path-suffixed form) with the
          document an OAuth client reads before it has any credential — so this rule is served
          regardless of deployment visibility. <code>resource</code> is{' '}
          <code>https://&lt;host&gt;{resource || '/…'}</code>; <code>authorization_servers</code> is
          this instance&apos;s issuer. Nothing is baked in.
        </p>
      </div>

      {pathWarning && (
        <Alert variant="destructive" data-testid="prm-path-warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            This rule&apos;s path is <code>{ownRule.pathPattern}</code>; clients look for the
            document at <code>{PROTECTED_RESOURCE_PATH}*</code> (GET).
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-resource`}>
          Resource path <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`${id}-resource`}
          value={resource}
          placeholder="/api/mcp"
          onChange={(e) => patch({ resource: e.target.value })}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground" data-testid="prm-mcp-hint">
          The <code>mcp_handler</code> rule&apos;s path on this host.{' '}
          {!resource
            ? ''
            : mcp
              ? `Found in this set: ${mcp.rule.pathPattern}${mcp.serverName ? ` (${mcp.serverName})` : ''}.`
              : 'No mcp_handler rule at this path in this set — another set attached to the alias may hold it; otherwise scopes_supported will be empty unless declared.'}
        </p>
      </div>

      <div className="space-y-2">
        <Label>scopes_supported</Label>
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="scopes mode">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-scopes-mode`}
              checked={!declared}
              onChange={() => patch({ scopes: undefined })}
            />
            Derive from the MCP server&apos;s tools
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-scopes-mode`}
              checked={declared}
              onChange={() => patch({ scopes: derived })}
            />
            Declare
          </label>
        </div>
        {declared ? (
          <StringListInput
            label="Scopes"
            value={scopes}
            onChange={(next) => patch({ scopes: next })}
            placeholder="namespace:verb"
            suggestions={derived.filter((s) => !scopes.includes(s)).map((value) => ({ value }))}
            help="Published verbatim. This list is the authorize flow's allowlist: a scope not here cannot be granted over OAuth."
          />
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="prm-derived">
            derived: {derived.length ? derived.map((s) => <code key={s}>{s} </code>) : 'none'} — the
            union of <code>requiredScopes</code> on the <code>auth_required</code> validators of the
            sibling rules the MCP server&apos;s tools map to. Declare instead when a sibling&apos;s
            scope must not be offered over OAuth.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>Resource name</Label>
          <Input
            id={`${id}-name`}
            value={str(config.resourceName)}
            placeholder={mcp?.serverName || 'defaults to the MCP server name'}
            onChange={(e) => patch({ resourceName: e.target.value || undefined })}
            className="text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-docs`}>Documentation URL</Label>
          <Input
            id={`${id}-docs`}
            value={str(config.resourceDocumentation)}
            placeholder="https://…"
            onChange={(e) => patch({ resourceDocumentation: e.target.value || undefined })}
            className="font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
}
