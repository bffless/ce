import { HardDrive, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatStorageSize } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface StorageIndicatorProps {
  storageBytes: number;
  showTooltip?: boolean;
  className?: string;
}

/**
 * Storage usage indicator with color-coded thresholds
 * - Green: < 100MB
 * - Yellow: 100MB - 500MB
 * - Red: > 500MB
 */
export function StorageIndicator({
  storageBytes,
  showTooltip = true,
  className,
}: StorageIndicatorProps) {
  const storageMB = storageBytes / (1024 * 1024);

  // Color coding based on storage thresholds
  const getColorClass = () => {
    if (storageMB < 100) return 'text-green-600 dark:text-green-400';
    if (storageMB < 500) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getStorageLevel = () => {
    if (storageMB < 100) return 'Low usage';
    if (storageMB < 500) return 'Moderate usage';
    return 'High usage - consider cleanup';
  };

  const colorClass = getColorClass();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <HardDrive className={cn('h-4 w-4', colorClass)} />
      <span className="text-sm text-muted-foreground">
        {formatStorageSize(storageBytes)}
      </span>
      {showTooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex">
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p className="font-semibold">{getStorageLevel()}</p>
              <p className="text-xs text-muted-foreground">
                {storageBytes.toLocaleString()} bytes
              </p>
              <p className="text-xs text-muted-foreground">
                {storageMB.toFixed(2)} MB
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
