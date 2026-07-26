import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ArrowLeft, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useGetProxyRuleQuery,
  useGetRuleLogsQuery,
  useClearRuleLogsMutation,
} from '@/services/proxyRulesApi';
import { PipelineLogDetail } from '@/components/proxy-rules/PipelineLogDetail';

export default function PipelineLogsPage() {
  const { owner, repo, ruleSetId, ruleId } = useParams<{
    owner: string;
    repo: string;
    ruleSetId: string;
    ruleId: string;
  }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const { data: rule } = useGetProxyRuleQuery(ruleId!);

  useDocumentTitle(['Logs', rule?.pathPattern, 'Proxy Rules', `${owner}/${repo}`]);

  const { data: logsData, isLoading } = useGetRuleLogsQuery(
    { ruleId: ruleId!, page, pageSize: 20 },
    { pollingInterval: 10000 },
  );
  const [clearLogs, { isLoading: isClearing }] = useClearRuleLogsMutation();

  const handleClearLogs = async () => {
    try {
      await clearLogs(ruleId!).unwrap();
      toast({ title: 'Logs cleared' });
      setShowClearDialog(false);
    } catch (err) {
      toast({
        title: 'Error',
        description: (err as { data?: { message?: string } })?.data?.message || 'Failed to clear logs',
        variant: 'destructive',
      });
    }
  };

  const totalPages = logsData ? Math.ceil(logsData.total / logsData.pageSize) : 0;

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/repo/${owner}/${repo}/proxy-rules`}>Proxy Rules</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/repo/${owner}/${repo}/proxy-rules/${ruleSetId}`}>Rule Set</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/repo/${owner}/${repo}/proxy-rules/${ruleSetId}/${ruleId}`}>
                {rule?.pathPattern || 'Rule'}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Execution Logs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/repo/${owner}/${repo}/proxy-rules/${ruleSetId}/${ruleId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Execution Logs</h2>
            {rule && (
              <p className="text-sm text-muted-foreground">
                <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{rule.pathPattern}</code>
                {' '}{rule.pipelineConfig?.name && `- ${rule.pipelineConfig.name}`}
              </p>
            )}
          </div>
        </div>
        {logsData && logsData.total > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowClearDialog(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear Logs
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {logsData ? `${logsData.total} execution${logsData.total === 1 ? '' : 's'}` : 'Loading...'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !logsData || logsData.logs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No execution logs yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Logs will appear here when the pipeline is triggered with debug enabled.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {logsData.logs.map((log) => (
                <div key={log.id}>
                  <div
                    onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                    className="flex items-center gap-3 p-3 border rounded-md bg-background transition-colors cursor-pointer hover:bg-accent"
                  >
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        log.success ? 'bg-green-500' : 'bg-red-500'
                      }`}
                      title={log.success ? 'Success' : 'Failed'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {log.method}
                        </span>
                        <span className="truncate text-muted-foreground">{log.path}</span>
                      </div>
                      {log.errorMessage && (
                        <p className="text-xs text-red-500 mt-0.5 truncate">{log.errorMessage}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                      <span>{log.statusCode}</span>
                      <span>{log.durationMs}ms</span>
                      <span>{log.stepsCount} step{log.stepsCount === 1 ? '' : 's'}</span>
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  {expandedLogId === log.id && (
                    <div className="ml-5 mt-1 mb-2">
                      <PipelineLogDetail logId={log.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear Logs Confirmation */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Execution Logs</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all execution logs for this rule?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLogs}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isClearing}
            >
              {isClearing ? 'Clearing...' : 'Clear All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
