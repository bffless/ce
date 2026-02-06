import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useGetMigrationProgressQuery,
  useCancelMigrationMutation,
  type MigrationProgress as MigrationProgressType,
} from '@/services/migrationApi';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Pause, Clock } from 'lucide-react';

interface MigrationProgressProps {
  onComplete?: () => void;
}

export function MigrationProgress({ onComplete }: MigrationProgressProps) {
  const { data: progress, refetch } = useGetMigrationProgressQuery(undefined, {
    pollingInterval: 1000, // Poll every second during migration
    skip: false,
  });
  const [cancelMigration, { isLoading: cancelling }] = useCancelMigrationMutation();

  // If no progress or status is 'none', return null
  if (!progress || progress.status === 'none') {
    return null;
  }

  // Type guard for actual progress
  const migrationProgress = progress as MigrationProgressType;

  const percentComplete =
    migrationProgress.totalFiles > 0
      ? Math.round((migrationProgress.migratedFiles / migrationProgress.totalFiles) * 100)
      : 0;

  const bytesPercent =
    migrationProgress.totalBytes > 0
      ? Math.round((migrationProgress.migratedBytes / migrationProgress.totalBytes) * 100)
      : 0;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleTimeString();
  };

  const StatusIcon = () => {
    switch (migrationProgress.status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'cancelled':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'paused':
        return <Pause className="h-5 w-5 text-yellow-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    }
  };

  const getStatusText = () => {
    switch (migrationProgress.status) {
      case 'completed':
        return 'Migration Complete';
      case 'failed':
        return 'Migration Failed';
      case 'cancelled':
        return 'Migration Cancelled';
      case 'paused':
        return 'Migration Paused';
      case 'in_progress':
        return 'Migrating Files...';
      case 'pending':
        return 'Preparing Migration...';
      default:
        return migrationProgress.status;
    }
  };

  const handleCancel = async () => {
    await cancelMigration();
    refetch();
  };

  // Call onComplete when migration finishes
  if (migrationProgress.status === 'completed' && onComplete) {
    // Defer to avoid calling during render
    setTimeout(onComplete, 0);
  }

  return (
    <div className="space-y-6 p-6 border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusIcon />
          <div>
            <h3 className="font-semibold">Storage Migration</h3>
            <p className="text-sm text-muted-foreground">{getStatusText()}</p>
          </div>
        </div>
        {migrationProgress.status === 'in_progress' && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel Migration'}
          </Button>
        )}
      </div>

      {/* Progress Bars */}
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Files</span>
            <span>
              {migrationProgress.migratedFiles.toLocaleString()} /{' '}
              {migrationProgress.totalFiles.toLocaleString()} ({percentComplete}%)
            </span>
          </div>
          <Progress value={percentComplete} className="h-2" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Data</span>
            <span>
              {formatBytes(migrationProgress.migratedBytes)} /{' '}
              {formatBytes(migrationProgress.totalBytes)} ({bytesPercent}%)
            </span>
          </div>
          <Progress value={bytesPercent} className="h-2" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Started</p>
          <p className="font-medium">{formatTime(migrationProgress.startedAt)}</p>
        </div>
        {migrationProgress.estimatedCompletionAt && migrationProgress.status === 'in_progress' && (
          <div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <p>Est. Completion</p>
            </div>
            <p className="font-medium">{formatTime(migrationProgress.estimatedCompletionAt)}</p>
          </div>
        )}
        <div>
          <p className="text-muted-foreground">Failed</p>
          <p className={`font-medium ${migrationProgress.failedFiles > 0 ? 'text-red-500' : ''}`}>
            {migrationProgress.failedFiles}
          </p>
        </div>
      </div>

      {/* Current File */}
      {migrationProgress.currentFile && migrationProgress.status === 'in_progress' && (
        <div className="text-sm">
          <p className="text-muted-foreground">Current file</p>
          <p className="font-mono text-xs truncate">{migrationProgress.currentFile}</p>
        </div>
      )}

      {/* Errors */}
      {migrationProgress.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {migrationProgress.errors.length} file(s) failed to migrate.
            {migrationProgress.canResume && ' You can resume the migration after fixing the issues.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Success Message */}
      {migrationProgress.status === 'completed' && migrationProgress.failedFiles === 0 && (
        <Alert className="bg-green-500/10 border-green-500/20">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700 dark:text-green-400">
            All files migrated successfully! You can now switch to the new storage provider.
          </AlertDescription>
        </Alert>
      )}

      {/* Completed with failures */}
      {migrationProgress.status === 'completed' && migrationProgress.failedFiles > 0 && (
        <Alert className="bg-yellow-500/10 border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-yellow-700 dark:text-yellow-400">
            Migration completed with {migrationProgress.failedFiles} failed file(s). You can proceed
            with the migration but some files were not transferred.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
