// Step editor for `remote_request`: call one of the instance's admin-configured
// remote connections with CE's own identity.
//
// The difference from http_request is the target: never a URL the step author
// types, always a NAMED connection an admin created under Settings →
// Infrastructure → Remote connections. The connection owns the base URL, the
// auth mode and the credential, so a rule can neither point the platform
// identity at an arbitrary host nor need editing when a service moves.
import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useListRemoteConnectionNamesQuery } from '@/services/settingsApi';
import { ExpressionInput } from './ExpressionInput';
import type { RemoteRequestHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

/** Backend default (REMOTE_REQUEST_DEFAULT_TIMEOUT_S). */
const DEFAULT_TIMEOUT_SECONDS = 300;
/**
 * Ceiling offered by this editor. The server enforces the real limit —
 * `REMOTE_REQUEST_MAX_SECONDS` (also 3600 by default), which an operator can
 * lower — so a config saved here can still be refused on a tightened instance.
 */
const REMOTE_REQUEST_MAX_SECONDS_UI = 3600;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * The transport mints the connection's own Authorization header and makes it
 * win, and the server rejects the config outright — so the editor drops it
 * before it can be saved instead of letting the step fail later.
 */
function isAuthorizationHeader(key: string): boolean {
  return key.trim().toLowerCase() === 'authorization';
}

function clampTimeout(n: number): number {
  if (n < 1) return 1;
  if (n > REMOTE_REQUEST_MAX_SECONDS_UI) return REMOTE_REQUEST_MAX_SECONDS_UI;
  return n;
}

interface RemoteRequestConfigProps {
  config: Partial<RemoteRequestHandlerConfig>;
  onChange: (config: RemoteRequestHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

export function RemoteRequestConfig({
  config,
  onChange,
  previousSteps = [],
}: RemoteRequestConfigProps) {
  const { data: connections, isLoading } = useListRemoteConnectionNamesQuery();
  // This editor has no `condition` field, but rules-as-code can author one —
  // rebuilding the config from local state must not silently drop it.
  const condition = config.condition;
  const [connection, setConnection] = useState(config.connection || '');
  const [path, setPath] = useState(config.path || '');
  const [method, setMethod] = useState<RemoteRequestHandlerConfig['method']>(
    config.method || 'POST',
  );
  const [bodyMode, setBodyMode] = useState<'expression' | 'fields'>(
    typeof config.body === 'object' && config.body !== null ? 'fields' : 'expression',
  );
  const [body, setBody] = useState(typeof config.body === 'string' ? config.body : '');
  const [bodyFields, setBodyFields] = useState<[string, string][]>(
    typeof config.body === 'object' && config.body !== null ? Object.entries(config.body) : [],
  );
  const [headers, setHeaders] = useState<[string, string][]>(
    config.headers ? Object.entries(config.headers) : [],
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
  );
  // failOnError defaults to true at the backend; the UI mirrors that — switch ON means halt on non-2xx.
  const [failOnError, setFailOnError] = useState(config.failOnError !== false);

  useEffect(() => {
    const usableHeaders = headers.filter(([k]) => k.trim() && !isAuthorizationHeader(k));
    const headerObj = usableHeaders.length > 0 ? Object.fromEntries(usableHeaders) : undefined;

    let resolvedBody: string | Record<string, string> | undefined;
    if (method !== 'GET') {
      if (bodyMode === 'fields') {
        const filtered = bodyFields.filter(([k]) => k.trim());
        resolvedBody = filtered.length > 0 ? Object.fromEntries(filtered) : undefined;
      } else {
        resolvedBody = body.trim() || undefined;
      }
    }

    // Keys are omitted rather than set to undefined: this object is the step's
    // stored config, and an explicit `body: undefined` would survive into the
    // rule JSON diffing as a change that isn't one.
    onChange({
      ...(condition ? { condition } : {}),
      connection,
      ...(path.trim() ? { path: path.trim() } : {}),
      method,
      ...(resolvedBody === undefined ? {} : { body: resolvedBody }),
      ...(headerObj === undefined ? {} : { headers: headerObj }),
      timeoutSeconds,
      failOnError,
    });
  }, [
    condition,
    connection,
    path,
    method,
    body,
    bodyMode,
    bodyFields,
    headers,
    timeoutSeconds,
    failOnError,
    onChange,
  ]);

  const isBodyMethod = method !== 'GET';
  const options = connections ?? [];

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Connection */}
        <div className="space-y-2">
          <Label htmlFor="remote-connection">Connection *</Label>
          {isLoading ? (
            <Skeleton className="h-9 w-72" />
          ) : options.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No remote connections configured — an admin adds them under Settings → Infrastructure
            </p>
          ) : (
            <Select value={connection} onValueChange={setConnection}>
              <SelectTrigger id="remote-connection" aria-label="Connection" className="w-72">
                <SelectValue placeholder="Select a connection" />
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    <span className="flex items-center gap-2">
                      {c.name}
                      {/* An unauthenticated connection is a deliberate admin choice, but
                          the step author should see it before pointing a rule at it. */}
                      {c.auth === 'none' && (
                        <Badge variant="destructive" className="text-[10px]">
                          None
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            The connection supplies the base URL and the identity. Admins manage them under Settings
            → Infrastructure → Remote connections.
          </p>
        </div>

        {/* Path */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Path</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Appended to the connection&apos;s URL. Must resolve to something starting with{' '}
                  <code>/</code>. Expressions and <code>{'{{templates}}'}</code> are allowed.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <ExpressionInput
            value={path}
            onChange={setPath}
            placeholder="/render"
            previousSteps={previousSteps}
          />
        </div>

        {/* Method */}
        <div className="space-y-2">
          <Label htmlFor="remote-method">Method</Label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as RemoteRequestHandlerConfig['method'])}
          >
            <SelectTrigger id="remote-method" aria-label="Method" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Timeout */}
        <div className="space-y-2">
          <Label htmlFor="remote-timeout">Timeout (seconds)</Label>
          <Input
            id="remote-timeout"
            type="number"
            min={1}
            max={REMOTE_REQUEST_MAX_SECONDS_UI}
            className="w-32"
            value={String(timeoutSeconds)}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              setTimeoutSeconds(
                Number.isFinite(parsed) ? clampTimeout(parsed) : DEFAULT_TIMEOUT_SECONDS,
              );
            }}
          />
          <p className="text-xs text-muted-foreground">
            How long CE holds the request open — a remote job is allowed to be slow. 1–
            {REMOTE_REQUEST_MAX_SECONDS_UI} seconds (the server may enforce a lower ceiling).
          </p>
        </div>

        {/* Fail on Error */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label>Fail on non-2xx response</Label>
            <p className="text-xs text-muted-foreground">
              Halt the pipeline on non-2xx (off: the step outputs{' '}
              <code className="text-[10px]">{'{ok:false, status, body}'}</code> and the next step
              can branch)
            </p>
          </div>
          <Switch
            aria-label="Fail on non-2xx response"
            checked={failOnError}
            onCheckedChange={setFailOnError}
          />
        </div>

        {/* Body (for non-GET methods) */}
        {isBodyMethod && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label>Request Body</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Expression mode: reference a step output (e.g., <code>steps.validate</code>).
                    </p>
                    <p>Fields mode: define key-value pairs with expression values.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={bodyMode}
                onValueChange={(v) => setBodyMode(v as 'expression' | 'fields')}
              >
                <SelectTrigger aria-label="Body mode" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expression">Expression</SelectItem>
                  <SelectItem value="fields">Fields</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bodyMode === 'expression' ? (
              <ExpressionInput
                value={body}
                onChange={setBody}
                placeholder="steps.validate"
                previousSteps={previousSteps}
              />
            ) : (
              <div className="space-y-2">
                {bodyFields.map(([key, value], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={key}
                      onChange={(e) => {
                        const updated = [...bodyFields];
                        updated[i] = [e.target.value, value];
                        setBodyFields(updated);
                      }}
                      placeholder="field name"
                      className="w-1/3"
                    />
                    <ExpressionInput
                      value={value}
                      onChange={(v) => {
                        const updated = [...bodyFields];
                        updated[i] = [key, v];
                        setBodyFields(updated);
                      }}
                      placeholder="value or expression"
                      previousSteps={previousSteps}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setBodyFields(bodyFields.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBodyFields([...bodyFields, ['', '']])}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Field
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Custom Headers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Custom Headers</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHeaders([...headers, ['', '']])}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Header
            </Button>
          </div>
          {headers.map(([key, value], i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  value={key}
                  onChange={(e) => {
                    const updated = [...headers];
                    updated[i] = [e.target.value, value];
                    setHeaders(updated);
                  }}
                  placeholder="Header-Name"
                  className="w-1/3"
                />
                <ExpressionInput
                  value={value}
                  onChange={(v) => {
                    const updated = [...headers];
                    updated[i] = [key, v];
                    setHeaders(updated);
                  }}
                  placeholder="value or expression"
                  previousSteps={previousSteps}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              {isAuthorizationHeader(key) && (
                <p className="text-xs text-destructive">
                  Authorization is dropped — the connection supplies the identity.
                </p>
              )}
            </div>
          ))}
          {headers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No custom headers configured. <code>Authorization</code> is rejected — the connection
              supplies the identity.
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Output is always{' '}
          <code className="text-[10px]">
            {'{ ok, status, body, latencyMs, connection, attempts }'}
          </code>{' '}
          — read fields as{' '}
          <code className="text-[10px]">steps.&lt;name&gt;.body.&lt;field&gt;</code>.
        </p>
      </div>
    </TooltipProvider>
  );
}
