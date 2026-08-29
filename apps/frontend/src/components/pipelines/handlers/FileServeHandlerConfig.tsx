import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExpressionInput } from './ExpressionInput';
import type { FileServeHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

/**
 * Config editor for file_serve_handler.
 *
 * The user picks ONE of two ways to name the object to serve:
 *   - Sub-directory: the file path is derived from the request URL under
 *     /api/uploads/<subDir>/.
 *   - Key: an explicit object relative to the project's uploads root, resolved
 *     at runtime (supports expressions, e.g. a manifest lookup). Serves the
 *     object IN-PLACE so relative sub-resources keep resolving same-origin.
 */
export function FileServeHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  // Track the selected mode in local state. Deriving it from whether `key` has
  // content would strand the user in sub-directory mode: switching to Key while
  // the key is still empty would leave the derived mode at 'subDir', so the Key
  // field could never appear. Seed from the existing config (key present → key).
  const [mode, setMode] = useState<'subDir' | 'key'>(
    typeof typedConfig.key === 'string' && typedConfig.key.length > 0 ? 'key' : 'subDir',
  );

  const update = (partial: Partial<Config>) => {
    onChange({ ...typedConfig, ...partial } as Config);
  };

  const switchMode = (next: 'subDir' | 'key') => {
    setMode(next);
    // Keep only the field for the selected mode so exactly one is sent.
    if (next === 'subDir') {
      onChange({ ...typedConfig, key: undefined } as Config);
    } else {
      onChange({ ...typedConfig, subDir: undefined } as Config);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Source</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => switchMode('subDir')}
            className={`rounded border px-3 py-1.5 text-sm ${
              mode === 'subDir' ? 'border-primary bg-primary/10 font-medium' : 'border-input'
            }`}
          >
            Sub-directory
          </button>
          <button
            type="button"
            onClick={() => switchMode('key')}
            className={`rounded border px-3 py-1.5 text-sm ${
              mode === 'key' ? 'border-primary bg-primary/10 font-medium' : 'border-input'
            }`}
          >
            Key
          </button>
        </div>
      </div>

      {mode === 'subDir' ? (
        <div className="space-y-2">
          <Label>Sub-directory</Label>
          <Input
            value={typedConfig.subDir || ''}
            onChange={(e) => update({ subDir: e.target.value })}
            placeholder="e.g., images, documents"
          />
          <p className="text-xs text-muted-foreground">
            Storage sub-directory to serve files from. The file path is derived from the request URL
            under <code>/api/uploads/&lt;subDir&gt;/</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Key</Label>
          <ExpressionInput
            value={typedConfig.key || ''}
            onChange={(v) => update({ key: v })}
            placeholder="e.g., content/{{steps.resolve.serveKey}}"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            Serve an explicit object, relative to the uploads root. Lets a prior step name the
            object (e.g. a manifest lookup) and serves it in-place at the request URL — so a Site's
            relative assets keep resolving same-origin. A <code>..</code>-containing value is
            rejected.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Cache Max-Age (seconds)</Label>
        <Input
          type="number"
          value={typedConfig.cacheMaxAge ?? ''}
          onChange={(e) =>
            update({ cacheMaxAge: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="3600"
        />
        <p className="text-xs text-muted-foreground">
          Cache-Control max-age header value. Default: 3600 (1 hour).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Download (attachment)</Label>
        <ExpressionInput
          value={typeof typedConfig.download === 'string' ? typedConfig.download : ''}
          onChange={(v) => update({ download: v || undefined })}
          placeholder="e.g., request.query.download"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          When this resolves truthy the file is sent as an attachment (
          <code>Content-Disposition</code>) named after the upload&apos;s original filename, so the
          browser saves it instead of showing it. <code>request.query.download</code> lets one rule
          serve both inline views and <code>?download=1</code> links. Leave empty to always serve
          inline.
        </p>
      </div>
    </div>
  );
}
