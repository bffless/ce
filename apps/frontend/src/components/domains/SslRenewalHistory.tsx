import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, MinusCircle, Clock, User, Bot } from 'lucide-react';
import { useGetSslRenewalHistoryQuery } from '@/services/domainsApi';
import { format, formatDistanceToNow } from 'date-fns';

interface SslRenewalHistoryProps {
  domainId: string;
  limit?: number;
}

export function SslRenewalHistory({
  domainId,
  limit = 5,
}: SslRenewalHistoryProps) {
  const { data: history = [], isLoading } = useGetSslRenewalHistoryQuery({
    domainId,
    limit,
  });

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading history...</div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No renewal history</div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Renewal History</h4>
      <div className="space-y-2">
        {history.map((record) => (
          <div
            key={record.id}
            className="flex items-center justify-between p-2 border rounded text-sm"
          >
            <div className="flex items-center gap-2">
              {record.status === 'success' && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              {record.status === 'failed' && (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              {record.status === 'skipped' && (
                <MinusCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>
                {record.status === 'success' && 'Renewed'}
                {record.status === 'failed' && 'Failed'}
                {record.status === 'skipped' && 'Skipped'}
              </span>
              {record.triggeredBy === 'auto' ? (
                <span title="Automatic">
                  <Bot className="h-3 w-3 text-muted-foreground" />
                </span>
              ) : (
                <span title="Manual">
                  <User className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
              {record.status === 'failed' && record.errorMessage && (
                <Badge variant="destructive" className="text-xs">
                  {record.errorMessage.slice(0, 30)}
                  {record.errorMessage.length > 30 ? '...' : ''}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span title={format(new Date(record.createdAt), 'PPpp')}>
                {formatDistanceToNow(new Date(record.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
