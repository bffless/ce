import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, HelpCircle, Check, ChevronsUpDown } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ResponseHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';
import { ExpressionInput } from './ExpressionInput';

interface ResponseHandlerConfigProps {
  config: Partial<ResponseHandlerConfig>;
  onChange: (config: ResponseHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

interface HeaderEntry {
  key: string;
  value: string;
}

interface BodyFieldEntry {
  key: string;
  expression: string;
}

const STATUS_CODES = [
  { value: '200', label: '200 OK' },
  { value: '201', label: '201 Created' },
  { value: '204', label: '204 No Content' },
  { value: '400', label: '400 Bad Request' },
  { value: '401', label: '401 Unauthorized' },
  { value: '403', label: '403 Forbidden' },
  { value: '404', label: '404 Not Found' },
  { value: '500', label: '500 Internal Server Error' },
];

const CONTENT_TYPES = [
  { value: 'application/json', label: 'JSON (application/json)' },
  { value: 'text/html', label: 'HTML (text/html)' },
  { value: 'text/plain', label: 'Plain Text (text/plain)' },
  { value: 'application/xml', label: 'XML (application/xml)' },
  { value: 'text/xml', label: 'XML (text/xml)' },
  { value: 'application/rss+xml', label: 'RSS (application/rss+xml)' },
  { value: 'application/atom+xml', label: 'Atom (application/atom+xml)' },
  { value: 'text/csv', label: 'CSV (text/csv)' },
  { value: 'text/calendar', label: 'Calendar (text/calendar)' },
];

export function ResponseHandlerConfig({ config, onChange, previousSteps = [] }: ResponseHandlerConfigProps) {
  const [status, setStatus] = useState<number>(config.status || 200);
  const [contentType, setContentType] = useState(config.contentType || 'application/json');
  const [contentTypeOpen, setContentTypeOpen] = useState(false);
  // Search text is kept separate from contentType so opening the picker always
  // shows the full preset list instead of pre-filtering by the current value.
  const [contentTypeSearch, setContentTypeSearch] = useState('');
  const [bodyMode, setBodyMode] = useState<'template' | 'json'>(() => {
    return typeof config.body === 'object' ? 'json' : 'template';
  });
  const [bodyTemplate, setBodyTemplate] = useState<string>(() => {
    return typeof config.body === 'string' ? config.body : '';
  });
  const [bodyFields, setBodyFields] = useState<BodyFieldEntry[]>(() => {
    if (typeof config.body === 'object' && config.body !== null) {
      const entries = Object.entries(config.body);
      return entries.length > 0
        ? entries.map(([key, expression]) => ({ key, expression }))
        : [{ key: '', expression: '' }];
    }
    return [{ key: '', expression: '' }];
  });
  const [headers, setHeaders] = useState<HeaderEntry[]>(() => {
    const existing = config.headers || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([key, value]) => ({ key, value }))
      : [];
  });

  useEffect(() => {
    let body: string | Record<string, string>;
    if (bodyMode === 'template') {
      body = bodyTemplate;
    } else {
      const bodyObj: Record<string, string> = {};
      for (const field of bodyFields) {
        if (field.key.trim()) {
          bodyObj[field.key.trim()] = field.expression;
        }
      }
      body = bodyObj;
    }

    const headersObj: Record<string, string> = {};
    for (const header of headers) {
      if (header.key.trim()) {
        headersObj[header.key.trim()] = header.value;
      }
    }

    onChange({
      status,
      body,
      contentType,
      headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    });
  }, [status, bodyMode, bodyTemplate, bodyFields, contentType, headers, onChange]);

  const handleAddBodyField = () => {
    setBodyFields([...bodyFields, { key: '', expression: '' }]);
  };

  const handleRemoveBodyField = (index: number) => {
    if (bodyFields.length > 1) {
      setBodyFields(bodyFields.filter((_, i) => i !== index));
    }
  };

  const handleBodyFieldChange = (index: number, updates: Partial<BodyFieldEntry>) => {
    setBodyFields(bodyFields.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="status">Status Code</Label>
          <Select
            value={String(status)}
            onValueChange={(v) => setStatus(Number(v))}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_CODES.map((code) => (
                <SelectItem key={code.value} value={code.value}>
                  {code.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contentType">Content Type</Label>
          <Popover
            open={contentTypeOpen}
            onOpenChange={(open) => {
              setContentTypeOpen(open);
              if (open) setContentTypeSearch('');
            }}
          >
            <PopoverTrigger asChild>
              <Button
                id="contentType"
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={contentTypeOpen}
                className="w-full justify-between font-normal font-mono text-sm"
              >
                {contentType || 'Select or type a content type...'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search or type a content type..."
                  value={contentTypeSearch}
                  onValueChange={(v) => {
                    setContentTypeSearch(v);
                    setContentType(v);
                  }}
                />
                <CommandList>
                  <CommandEmpty>
                    <div className="py-2 text-sm text-muted-foreground">
                      Using custom type: <span className="font-mono">{contentType}</span>
                    </div>
                  </CommandEmpty>
                  <CommandGroup>
                    {CONTENT_TYPES.map((ct) => (
                      <CommandItem
                        key={ct.value}
                        value={ct.value}
                        onSelect={() => {
                          setContentType(ct.value);
                          setContentTypeSearch('');
                          setContentTypeOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            contentType === ct.value ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        {ct.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Response Body</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="cursor-help">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p><strong>Template:</strong> Use <code>{'{{expression}}'}</code> for dynamic values</p>
                <p className="mt-1"><strong>JSON:</strong> Map keys to expressions</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <Tabs value={bodyMode} onValueChange={(v) => setBodyMode(v as 'template' | 'json')}>
          <TabsList>
            <TabsTrigger value="template">Template</TabsTrigger>
            <TabsTrigger value="json">JSON Object</TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="mt-2">
            <Textarea
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              placeholder='{"success": true, "message": "Created record {{steps.create.id}}"}'
              rows={4}
            />
          </TabsContent>

          <TabsContent value="json" className="mt-2 space-y-2">
            {bodyFields.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={field.key}
                  onChange={(e) => handleBodyFieldChange(index, { key: e.target.value })}
                  placeholder="key"
                  className="flex-1"
                />
                <span className="text-muted-foreground">:</span>
                <ExpressionInput
                  value={field.expression}
                  onChange={(value) => handleBodyFieldChange(index, { expression: value })}
                  placeholder="expression"
                  previousSteps={previousSteps}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveBodyField(index)}
                  disabled={bodyFields.length === 1}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={handleAddBodyField}>
              <Plus className="h-4 w-4 mr-1" />
              Add Field
            </Button>
          </TabsContent>
        </Tabs>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Custom Headers (optional)</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleAddHeader}>
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
                  onChange={(e) => handleHeaderChange(index, { key: e.target.value })}
                  placeholder="Header-Name"
                  className="flex-1"
                />
                <span className="text-muted-foreground">:</span>
                <Input
                  value={header.value}
                  onChange={(e) => handleHeaderChange(index, { value: e.target.value })}
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
  );
}
