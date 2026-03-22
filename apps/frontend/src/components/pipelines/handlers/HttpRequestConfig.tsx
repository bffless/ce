import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ExpressionInput } from './ExpressionInput';
import type { HttpRequestHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

interface HttpRequestConfigProps {
  config: Partial<HttpRequestHandlerConfig>;
  onChange: (config: HttpRequestHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

export function HttpRequestConfig({ config, onChange, previousSteps = [] }: HttpRequestConfigProps) {
  const [url, setUrl] = useState(config.url || '');
  const [method, setMethod] = useState<HttpRequestHandlerConfig['method']>(config.method || 'GET');
  const [forwardAuth, setForwardAuth] = useState(config.forwardAuth ?? false);
  const [body, setBody] = useState(typeof config.body === 'string' ? config.body : '');
  const [headers, setHeaders] = useState<[string, string][]>(
    config.headers ? Object.entries(config.headers) : [],
  );
  const [forwardHeaders, setForwardHeaders] = useState<string[]>(config.forwardHeaders || []);
  const [newForwardHeader, setNewForwardHeader] = useState('');

  useEffect(() => {
    const headerObj = headers.length > 0
      ? Object.fromEntries(headers.filter(([k]) => k.trim()))
      : undefined;

    const fwdHeaders = forwardHeaders.length > 0 ? forwardHeaders : undefined;

    onChange({
      url,
      method,
      forwardAuth: forwardAuth || undefined,
      body: body.trim() && method !== 'GET' ? body.trim() : undefined,
      headers: headerObj,
      forwardHeaders: fwdHeaders,
    });
  }, [url, method, forwardAuth, body, headers, forwardHeaders, onChange]);

  const isBodyMethod = method !== 'GET';

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* URL */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="http-url">URL *</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Target URL. Can use expressions like <code>steps.config.baseUrl</code></p>
              </TooltipContent>
            </Tooltip>
          </div>
          <ExpressionInput
            value={url}
            onChange={setUrl}
            placeholder="https://example.com/api/endpoint"
            previousSteps={previousSteps}
          />
        </div>

        {/* Method */}
        <div className="space-y-2">
          <Label>Method</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as HttpRequestHandlerConfig['method'])}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Forward Auth */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label>Forward Auth</Label>
            <p className="text-xs text-muted-foreground">
              Forward cookies and Authorization header from the original request
            </p>
          </div>
          <Switch checked={forwardAuth} onCheckedChange={setForwardAuth} />
        </div>

        {/* Body (for non-GET methods) */}
        {isBodyMethod && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="http-body">Request Body</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="cursor-help">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Expression that resolves to the body payload, e.g., <code>steps.validate</code></p>
                </TooltipContent>
              </Tooltip>
            </div>
            <ExpressionInput
              value={body}
              onChange={setBody}
              placeholder='steps.validate or { "amount": 1 }'
              previousSteps={previousSteps}
            />
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
              <Plus className="h-3 w-3 mr-1" />
              Add Header
            </Button>
          </div>
          {headers.map(([key, value], i) => (
            <div key={i} className="flex gap-2 items-center">
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
          ))}
          {headers.length === 0 && (
            <p className="text-xs text-muted-foreground">No custom headers configured</p>
          )}
        </div>

        {/* Forward Headers */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Forward Headers</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Headers to forward from the original request (e.g., <code>accept</code>, <code>content-type</code>)</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex gap-2">
            <Input
              value={newForwardHeader}
              onChange={(e) => setNewForwardHeader(e.target.value)}
              placeholder="header-name"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newForwardHeader.trim()) {
                  e.preventDefault();
                  setForwardHeaders([...forwardHeaders, newForwardHeader.trim().toLowerCase()]);
                  setNewForwardHeader('');
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newForwardHeader.trim()}
              onClick={() => {
                if (newForwardHeader.trim()) {
                  setForwardHeaders([...forwardHeaders, newForwardHeader.trim().toLowerCase()]);
                  setNewForwardHeader('');
                }
              }}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {forwardHeaders.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {forwardHeaders.map((h, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1"
                >
                  {h}
                  <button
                    type="button"
                    onClick={() => setForwardHeaders(forwardHeaders.filter((_, j) => j !== i))}
                    className="hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
