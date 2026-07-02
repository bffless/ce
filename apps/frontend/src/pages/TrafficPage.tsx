import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Pause, Play, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrafficHistoryTab } from '@/components/traffic/TrafficHistoryTab';
import { TrafficRollupTab } from '@/components/traffic/TrafficRollupTab';
import { statusColorClass } from '@/components/traffic/traffic-format';

/** A request observed by the backend's application interceptor (issue #389). */
export interface TrafficStreamEvent {
  id: string;
  timestamp: string;
  ip: string;
  method: string;
  path: string;
  httpVersion: string;
  status: number;
  bytes: number;
  referer: string | null;
  userAgent: string | null;
  host: string | null;
  classification: 'matched' | 'unmatched';
  line: string;
}

type ConnectionState = 'connecting' | 'live' | 'disconnected';

/** Cap the in-memory tail so a scanner storm can't grow the page unbounded. */
const MAX_EVENTS = 1000;

/** Display preference only — deliberately not pause state, which stays ephemeral. */
const WRAP_LINES_STORAGE_KEY = 'bffless.traffic.wrapLines';

/**
 * Default view: only the signal (Unmatched requests and 4xx/5xx responses).
 * "Show all" reveals the 200-OK asset firehose too.
 */
export function isSignalEvent(event: TrafficStreamEvent): boolean {
  return event.classification === 'unmatched' || event.status >= 400;
}

export function TrafficPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'live';

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#3a3a3a] dark:text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-[#d96459]" />
            Traffic
          </h1>
          <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground mt-1">
            Requests hitting this instance, as the application observes them
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab })}>
        <TabsList className="mb-4">
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="rollup">By IP</TabsTrigger>
        </TabsList>
        {/* forceMount keeps the live tail mounted (hidden) across tab switches,
            so the SSE connection and accumulated events survive visiting
            History / By IP. The other tabs re-query on mount instead. */}
        <TabsContent value="live" forceMount hidden={activeTab !== 'live'}>
          <LiveTrafficTab />
        </TabsContent>
        <TabsContent value="history">
          <TrafficHistoryTab />
        </TabsContent>
        <TabsContent value="rollup">
          <TrafficRollupTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function LiveTrafficTab() {
  const [events, setEvents] = useState<TrafficStreamEvent[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wrapLines, setWrapLines] = useState(
    () => localStorage.getItem(WRAP_LINES_STORAGE_KEY) === 'true',
  );
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || '';
    const source = new EventSource(`${baseUrl}/api/traffic/stream`, {
      withCredentials: true,
    });

    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection('disconnected');
    source.addEventListener('request', (message) => {
      if (pausedRef.current) return;
      const event = JSON.parse((message as MessageEvent).data) as TrafficStreamEvent;
      setEvents((prev) => {
        const next =
          prev.length >= MAX_EVENTS ? prev.slice(prev.length - MAX_EVENTS + 1) : prev.slice();
        next.push(event);
        return next;
      });
    });

    return () => source.close();
  }, []);

  const visibleEvents = showAll ? events : events.filter(isSignalEvent);

  // Keep the tail pinned to the newest line, like `docker compose logs -f`
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleEvents.length]);

  const clear = useCallback(() => setEvents([]), []);

  const toggleWrapLines = useCallback((checked: boolean) => {
    setWrapLines(checked);
    localStorage.setItem(WRAP_LINES_STORAGE_KEY, String(checked));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Live requests</CardTitle>
            <ConnectionBadge state={connection} paused={paused} />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
              <Label htmlFor="show-all" className="text-sm cursor-pointer">
                Show all
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="wrap-lines" checked={wrapLines} onCheckedChange={toggleWrapLines} />
              <Label htmlFor="wrap-lines" className="text-sm cursor-pointer">
                Wrap lines
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="outline" size="sm" onClick={clear}>
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
        {!showAll && (
          <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground">
            Showing Unmatched and 4xx/5xx requests only
            {events.length > visibleEvents.length &&
              ` — ${events.length - visibleEvents.length} matched request${events.length - visibleEvents.length === 1 ? '' : 's'} hidden`}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          data-testid="traffic-log"
          className={`bg-[#1e1e1e] rounded-md p-3 h-[32rem] overflow-y-auto font-mono text-xs leading-5 ${wrapLines ? '' : 'overflow-x-auto'}`}
        >
          {visibleEvents.length === 0 ? (
            <p className="text-gray-400">
              {connection === 'live'
                ? 'Waiting for requests…'
                : connection === 'connecting'
                  ? 'Connecting to stream…'
                  : 'Stream disconnected — retrying…'}
            </p>
          ) : (
            visibleEvents.map((event) => (
              <div
                key={event.id}
                className={`text-gray-200 ${wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre w-max min-w-full'}`}
              >
                {event.classification === 'unmatched' && (
                  <span className="text-[#d96459] mr-1" title="Unmatched request">
                    ●
                  </span>
                )}
                <span className={statusColorClass(event.status)}>{event.line}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionBadge({ state, paused }: { state: ConnectionState; paused: boolean }) {
  // Pause is a view state that trumps the connection state: while paused the
  // stream stays open but nothing appends, so advertising "Live" would lie.
  if (paused) {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
        <span className="h-2 w-2 rounded-full bg-amber-500 mr-1.5" />
        Paused
      </Badge>
    );
  }
  if (state === 'live') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
        Live
      </Badge>
    );
  }
  if (state === 'connecting') {
    return (
      <Badge variant="outline" className="text-[#4a4a4a] dark:text-muted-foreground">
        Connecting…
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-500/50 text-red-600 dark:text-red-400">
      Disconnected
    </Badge>
  );
}
