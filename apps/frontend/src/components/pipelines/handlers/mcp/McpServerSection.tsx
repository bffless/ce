import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { StringListInput } from './StringListInput';
import { PROTOCOL_VERSION_DEFAULTS, type McpConfig } from './model';

interface McpServerSectionProps {
  config: McpConfig;
  onChange: (patch: Partial<McpConfig>) => void;
  serverInfoError?: string;
}

/** `serverInfo`, `instructions` and (behind Advanced) `protocolVersions`. */
export function McpServerSection({ config, onChange, serverInfoError }: McpServerSectionProps) {
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
