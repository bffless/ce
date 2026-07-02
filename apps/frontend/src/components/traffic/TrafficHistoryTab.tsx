import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { downloadTrafficExport, useListTrafficRequestsQuery } from '@/services/trafficApi';
import { statusColorClass } from './traffic-format';

const PAGE_SIZE = 100;

const TIME_RANGES: Record<string, { label: string; hours?: number }> = {
  all: { label: 'Any time' },
  '1h': { label: 'Last hour', hours: 1 },
  '24h': { label: 'Last 24 hours', hours: 24 },
  '7d': { label: 'Last 7 days', hours: 24 * 7 },
};

/**
 * History view over the persisted Request log (issue #390): the Unmatched
 * (and, later, blocked) requests the application interceptor recorded,
 * rendered as access-log lines like the Live tail, with filters and export.
 */
export function TrafficHistoryTab() {
  const { toast } = useToast();
  const [ip, setIp] = useState('');
  const [path, setPath] = useState('');
  const [status, setStatus] = useState('');
  const [timeRange, setTimeRange] = useState('all');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Recomputed only when the range selection changes, so the query arg is stable
  const from = useMemo(() => {
    const hours = TIME_RANGES[timeRange]?.hours;
    return hours ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString() : undefined;
  }, [timeRange]);

  const filters = {
    ip: ip.trim() || undefined,
    path: path.trim() || undefined,
    status: status.trim() ? Number(status.trim()) : undefined,
    from,
  };

  const { data, isLoading, isFetching, error } = useListTrafficRequestsQuery({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      await downloadTrafficExport('requests', format, filters);
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const resetPageAnd =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setPage(1);
      setter(value);
    };

  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Request log</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => handleExport('csv')}
            >
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => handleExport('json')}
            >
              <Download className="h-4 w-4 mr-1" />
              JSON
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <div>
            <Label htmlFor="history-ip" className="text-xs">
              IP
            </Label>
            <Input
              id="history-ip"
              value={ip}
              onChange={(e) => resetPageAnd(setIp)(e.target.value)}
              placeholder="203.0.113.7"
              className="h-8 w-40"
            />
          </div>
          <div>
            <Label htmlFor="history-path" className="text-xs">
              Path contains
            </Label>
            <Input
              id="history-path"
              value={path}
              onChange={(e) => resetPageAnd(setPath)(e.target.value)}
              placeholder="/.env"
              className="h-8 w-48"
            />
          </div>
          <div>
            <Label htmlFor="history-status" className="text-xs">
              Status
            </Label>
            <Input
              id="history-status"
              value={status}
              onChange={(e) => resetPageAnd(setStatus)(e.target.value.replace(/\D/g, ''))}
              placeholder="404"
              className="h-8 w-20"
              inputMode="numeric"
            />
          </div>
          <div>
            <Label className="text-xs">Time range</Label>
            <Select value={timeRange} onValueChange={resetPageAnd(setTimeRange)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIME_RANGES).map(([key, range]) => (
                  <SelectItem key={key} value={key}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>Failed to load the Request log.</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#d96459]" />
          </div>
        ) : (
          <>
            <div
              data-testid="traffic-history-log"
              className="bg-[#1e1e1e] rounded-md p-3 h-[28rem] overflow-y-auto overflow-x-auto font-mono text-xs leading-5"
            >
              {!data || data.data.length === 0 ? (
                <p className="text-gray-400">No persisted requests match these filters.</p>
              ) : (
                data.data.map((entry) => (
                  <div key={entry.id} className="text-gray-200 whitespace-pre w-max min-w-full">
                    <span
                      className="text-[#d96459] mr-1"
                      title={
                        entry.classification === 'blocked' ? 'Blocked request' : 'Unmatched request'
                      }
                    >
                      ●
                    </span>
                    <span className={statusColorClass(entry.status)}>{entry.line}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between mt-3 text-sm text-[#4a4a4a] dark:text-muted-foreground">
              <span>
                Showing {showingFrom} to {showingTo} of {total}
                {isFetching && ' …'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data || page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
