import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProxyForwardConfig } from './types';

interface ProxyForwardConfigProps {
  config: Partial<ProxyForwardConfig>;
  onChange: (config: ProxyForwardConfig) => void;
}

interface HeaderEntry {
  key: string;
  value: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function ProxyForwardConfig({ config, onChange }: ProxyForwardConfigProps) {
  const [targetUrl, setTargetUrl] = useState(config.targetUrl || '');
  const [method, setMethod] = useState<string>(config.method || '');
  const [includeBody, setIncludeBody] = useState(config.includeBody ?? true);
  const [includeOriginalHeaders, setIncludeOriginalHeaders] = useState(
    config.includeOriginalHeaders ?? true,
  );
  const [timeout, setTimeout] = useState(config.timeout ?? 30000);
  const [headers, setHeaders] = useState<HeaderEntry[]>(() => {
    const existing = config.headers || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([key, value]) => ({ key, value }))
      : [];
  });

  useEffect(() => {
    const headersObj: Record<string, string> = {};
    for (const header of headers) {
      if (header.key.trim()) {
        headersObj[header.key.trim()] = header.value;
      }
    }

    onChange({
      targetUrl,
      method: method ? (method as ProxyForwardConfig['method']) : undefined,
      includeBody,
      includeOriginalHeaders,
      timeout,
      headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    });
  }, [targetUrl, method, includeBody, includeOriginalHeaders, timeout, headers, onChange]);

  const handleAddHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, updates: Partial<HeaderEntry>) => {
    setHeaders(headers.map((h, i) => (i === index ? { ...h, ...updates } : h)));
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Target URL */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="targetUrl">Target URL</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The URL to forward the request to. You can use template
                  expressions like{' '}
                  <code className="bg-muted px-1 rounded">
                    {'{{steps.myStep.id}}'}
                  </code>
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            id="targetUrl"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://api.example.com/webhook"
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{'{{expression}}'}</code>{' '}
            for dynamic values from pipeline data.
          </p>
        </div>

        {/* Method and Timeout */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="method">HTTP Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="method">
                <SelectValue placeholder="Same as original" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Same as original request</SelectItem>
                {HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              value={timeout}
              onChange={(e) => setTimeout(parseInt(e.target.value, 10) || 30000)}
              min={1000}
              max={60000}
              step={1000}
            />
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="includeBody">Include Request Body</Label>
              <p className="text-xs text-muted-foreground">
                Forward the original or modified request body
              </p>
            </div>
            <Switch
              id="includeBody"
              checked={includeBody}
              onCheckedChange={setIncludeBody}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="includeHeaders">Include Original Headers</Label>
              <p className="text-xs text-muted-foreground">
                Pass through headers from the original request
              </p>
            </div>
            <Switch
              id="includeHeaders"
              checked={includeOriginalHeaders}
              onCheckedChange={setIncludeOriginalHeaders}
            />
          </div>
        </div>

        {/* Custom Headers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label>Custom Headers</Label>
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    Add or override headers on the forwarded request. Values
                    support template expressions.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddHeader}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Header
            </Button>
          </div>

          {headers.length > 0 && (
            <div className="space-y-2">
              {headers.map((header, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={header.key}
                    onChange={(e) =>
                      handleHeaderChange(index, { key: e.target.value })
                    }
                    placeholder="Header-Name"
                    className="flex-1"
                  />
                  <span className="text-muted-foreground">:</span>
                  <Input
                    value={header.value}
                    onChange={(e) =>
                      handleHeaderChange(index, { value: e.target.value })
                    }
                    placeholder="value (can use {{expression}})"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveHeader(index)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
