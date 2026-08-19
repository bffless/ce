import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ExpressionInput } from './ExpressionInput';
import type { XmlFeedParseHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: XmlFeedParseHandlerConfig) => void;
  previousSteps?: PreviousStep[];
}

type Mode = 'urls' | 'xml';

function initialMode(typed: Partial<XmlFeedParseHandlerConfig>): Mode {
  return typed.xml !== undefined && typed.urls === undefined ? 'xml' : 'urls';
}

export function XmlFeedParseConfig({ config, onChange, previousSteps = [] }: Props) {
  const typed = config as unknown as Partial<XmlFeedParseHandlerConfig>;

  const [mode, setMode] = useState<Mode>(initialMode(typed));
  const [urls, setUrls] = useState<string>(typed.urls ?? '');
  const [xml, setXml] = useState<string>(typed.xml ?? '');
  const [concurrency, setConcurrency] = useState<string>(
    typed.concurrency !== undefined ? String(typed.concurrency) : '',
  );
  const [timeoutMs, setTimeoutMs] = useState<string>(
    typed.timeoutMs !== undefined ? String(typed.timeoutMs) : '',
  );

  useEffect(() => {
    const next: XmlFeedParseHandlerConfig = mode === 'xml' ? { xml } : { urls };
    if (mode === 'urls') {
      const c = Number(concurrency);
      if (concurrency.trim() && !Number.isNaN(c)) next.concurrency = c;
      const t = Number(timeoutMs);
      if (timeoutMs.trim() && !Number.isNaN(t)) next.timeoutMs = t;
    }
    onChange(next);
  }, [mode, urls, xml, concurrency, timeoutMs, onChange]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Source</Label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="urls">Fetch feed URL(s)</option>
          <option value="xml">Parse raw XML from a prior step</option>
        </select>
      </div>

      {mode === 'urls' ? (
        <>
          <div className="space-y-2">
            <Label>Feed URL(s)</Label>
            <ExpressionInput
              value={urls}
              onChange={setUrls}
              placeholder="steps.feeds.urls or https://blog.example.com/feed.xml"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              An expression resolving to a single URL string or an array of URL strings. Feeds are
              fetched concurrently; a bad feed records a per-source error without sinking the batch.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Concurrency</Label>
              <Input
                type="number"
                min={1}
                max={32}
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                placeholder="8"
              />
            </div>
            <div className="space-y-2">
              <Label>Per-feed timeout (ms)</Label>
              <Input
                type="number"
                min={1000}
                max={120000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                placeholder="30000"
              />
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label>Raw XML</Label>
          <ExpressionInput
            value={xml}
            onChange={setXml}
            placeholder="steps.download.body"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            An expression resolving to raw feed XML (RSS 2.0 / Atom / RDF) fetched by a prior step
            or uploaded by a user.
          </p>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">entries</code>
          <span className="text-muted-foreground">
            Normalized entries: guid, title, link, author, publishedAt, content, summary,
            enclosures[], extensions{'{}'}
          </span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">sources</code>
          <span className="text-muted-foreground">Per-source outcome (ok, count, error)</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">totalEntries</code>
          <span className="text-muted-foreground">Total parsed entry count</span>
        </div>
      </div>
    </div>
  );
}
