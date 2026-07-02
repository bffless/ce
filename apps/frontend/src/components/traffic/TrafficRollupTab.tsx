import { useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { downloadTrafficExport, useListTrafficIpRollupsQuery } from '@/services/trafficApi';

const PAGE_SIZE = 50;

type SortBy = 'requestCount' | 'lastSeenAt' | 'firstSeenAt';

const SORT_OPTIONS: Record<SortBy, string> = {
  requestCount: 'Most requests',
  lastSeenAt: 'Last seen',
  firstSeenAt: 'First seen',
};

/**
 * Per-IP rollup view (issue #390): the worst offenders across the persisted
 * Request log — request count, first/last seen, sample paths and user-agents.
 */
export function TrafficRollupTab() {
  const { toast } = useToast();
  const [ip, setIp] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('requestCount');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const ipFilter = ip.trim() || undefined;
  const { data, isLoading, isFetching, error } = useListTrafficIpRollupsQuery(
    {
      ip: ipFilter,
      sortBy,
      sortOrder: 'desc',
      page,
      pageSize: PAGE_SIZE,
    },
    // Rollups update continuously server-side; don't serve a stale cached page.
    { refetchOnMountOrArgChange: true },
  );

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      await downloadTrafficExport('ips', format, { ip: ipFilter });
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Per-IP rollup</CardTitle>
            <p className="text-xs text-[#4a4a4a] dark:text-muted-foreground mt-1">
              IPs that produced persisted (Unmatched/blocked) requests — matched traffic doesn't
              count here.
            </p>
          </div>
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
            <Label htmlFor="rollup-ip" className="text-xs">
              IP contains
            </Label>
            <Input
              id="rollup-ip"
              value={ip}
              onChange={(e) => {
                setPage(1);
                setIp(e.target.value);
              }}
              placeholder="203.0.113"
              className="h-8 w-40"
            />
          </div>
          <div>
            <Label className="text-xs">Sort by</Label>
            <Select
              value={sortBy}
              onValueChange={(value) => {
                setPage(1);
                setSortBy(value as SortBy);
              }}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_OPTIONS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
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
            <AlertDescription>Failed to load the per-IP rollup.</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#d96459]" />
          </div>
        ) : !data || data.data.length === 0 ? (
          <p className="text-sm text-[#4a4a4a] dark:text-muted-foreground py-8 text-center">
            No IPs match these filters.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Sample paths</TableHead>
                  <TableHead>Sample user-agents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((rollup) => (
                  <TableRow key={rollup.id}>
                    <TableCell className="font-mono text-xs">{rollup.ip}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rollup.requestCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(rollup.firstSeenAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(rollup.lastSeenAt).toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs max-w-64 truncate"
                      title={rollup.samplePaths.join('\n')}
                    >
                      {rollup.samplePaths.join(' ')}
                    </TableCell>
                    <TableCell
                      className="text-xs max-w-64 truncate"
                      title={rollup.sampleUserAgents.join('\n')}
                    >
                      {rollup.sampleUserAgents.join(' ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                  disabled={page >= data.totalPages}
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
