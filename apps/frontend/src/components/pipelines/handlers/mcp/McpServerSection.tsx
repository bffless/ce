import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { StringListInput } from './StringListInput';
import { PROTOCOL_VERSION_DEFAULTS, type McpConfig } from './model';
import { PROTECTED_RESOURCE_PATH, type DiscoverySummary } from './discovery';

interface McpServerSectionProps {
  config: McpConfig;
  onChange: (patch: Partial<McpConfig>) => void;
  serverInfoError?: string;
  /** Where the RFC 9728 discovery document comes from, read off the rule set; omitted when unknown. */
  discovery?: DiscoverySummary;
}

/** `serverInfo`, `instructions`, where OAuth discovery comes from, and (behind Advanced) `protocolVersions`. */
export function McpServerSection({
  config,
  onChange,
  serverInfoError,
  discovery,
}: McpServerSectionProps) {
  const id = useId();
  const [advanced, setAdvanced] = useState(config.protocolVersions.length > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>
            Server name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${id}-name`}
            value={config.serverInfo.name}
            placeholder="my-app"
            onChange={(e) =>
              onChange({ serverInfo: { ...config.serverInfo, name: e.target.value } })
            }
            className="font-mono text-sm"
            aria-invalid={serverInfoError ? true : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-version`}>
            Version <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`${id}-version`}
            value={config.serverInfo.version}
            placeholder="1.0.0"
            onChange={(e) =>
              onChange({ serverInfo: { ...config.serverInfo, version: e.target.value } })
            }
            className="font-mono text-sm"
            aria-invalid={serverInfoError ? true : undefined}
          />
        </div>
      </div>
      {serverInfoError ? (
        <p className="text-xs text-destructive">{serverInfoError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          What <code>initialize</code> reports as <code>serverInfo</code>. Clients show the name;
          bump the version when tools change.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-instructions`}>Instructions</Label>
        <Textarea
          id={`${id}-instructions`}
          value={config.instructions}
          placeholder="How a model should use this server: what the tools are for, what to pass, what to avoid."
          onChange={(e) => onChange({ instructions: e.target.value })}
          className="min-h-[80px] text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Sent once at <code>initialize</code>; most hosts put it in the model&apos;s system prompt.
        </p>
      </div>

      {discovery && <DiscoveryNote discovery={discovery} />}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-1 text-muted-foreground"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? (
            <ChevronDown className="h-4 w-4 mr-1" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-1" />
          )}
          Advanced
        </Button>
        {advanced && (
          <div className="mt-2 pl-1">
            <StringListInput
              label="Protocol versions"
              value={config.protocolVersions}
              onChange={(protocolVersions) => onChange({ protocolVersions })}
              placeholder={PROTOCOL_VERSION_DEFAULTS.join(', ')}
              help={`Newest first. Leave empty for the defaults (${PROTOCOL_VERSION_DEFAULTS.join(', ')}).`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The OAuth discovery contract, taught where the server is edited: a client
 * reads `/.well-known/oauth-protected-resource` before it has a credential, and
 * `scopes_supported` there is what it may be granted. Says which rule answers
 * and what the list will be — declared, or derived from the tools' siblings.
 */
function DiscoveryNote({ discovery }: { discovery: DiscoverySummary }) {
  const scopesLine = (scopes: { mode: 'declared' | 'derived'; values: string[] }) => (
    <>
      <code>scopes_supported</code> — {scopes.mode}:{' '}
      {scopes.values.length ? (
        scopes.values.map((s) => (
          <code key={s} className="mr-1">
            {s}
          </code>
        ))
      ) : (
        <span>none</span>
      )}
      {scopes.mode === 'derived' && (
        <>
          {' '}
          (the union of <code>requiredScopes</code> on the tools&apos; sibling rules; declare{' '}
          <code>scopes</code> on that step to publish a different list)
        </>
      )}
    </>
  );

  return (
    <div
      className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs text-muted-foreground"
      data-testid="mcp-discovery"
    >
      <p className="font-medium">OAuth discovery (RFC 9728)</p>
      {discovery.kind === 'handler' && (
        <>
          <p>
            Served by the <code>oauth_protected_resource</code> step on{' '}
            <code>{discovery.rulePath}</code>; <code>authorization_servers</code> is this
            instance&apos;s issuer.
          </p>
          <p>{scopesLine(discovery.scopes)}</p>
        </>
      )}
      {discovery.kind === 'custom' && (
        <p>
          Served by a custom rule at <code>{discovery.rulePath}</code>; its{' '}
          <code>scopes_supported</code> is whatever that rule emits. Replace it with an{' '}
          <code>oauth_protected_resource</code> step to derive the list from this server&apos;s
          tools and take <code>authorization_servers</code> from this instance.
        </p>
      )}
      {discovery.kind === 'none' && (
        <p>
          No <code>{PROTECTED_RESOURCE_PATH}</code> rule in this set. An OAuth client (claude.ai,
          Claude Code) cannot start without one: add a GET rule at{' '}
          <code>{PROTECTED_RESOURCE_PATH}*</code> with an <code>oauth_protected_resource</code> step
          whose <code>resource</code> is this rule&apos;s path. Another set attached to the same
          alias may already carry it.
        </p>
      )}
    </div>
  );
}
