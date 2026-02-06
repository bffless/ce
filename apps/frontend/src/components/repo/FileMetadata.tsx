import { formatDistanceToNow } from 'date-fns';

interface FileMetadataProps {
  /** File size in bytes */
  size?: number;
  /** MIME type */
  mimeType?: string;
  /** Created/modified date */
  createdAt?: string;
  /** Line count (for code files) */
  lineCount?: number;
}

/**
 * Formats bytes to human-readable size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FileMetadata({ size, mimeType, createdAt, lineCount }: FileMetadataProps) {
  return (
    <div className="border-t bg-muted/30 px-4 py-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {/* Line count */}
        {lineCount !== undefined && (
          <div className="flex items-center gap-1">
            <span className="font-medium">{lineCount.toLocaleString()}</span>
            <span>lines</span>
          </div>
        )}

        {/* File size */}
        {size !== undefined && (
          <>
            {lineCount !== undefined && <span className="text-muted-foreground/50">•</span>}
            <div className="flex items-center gap-1">
              <span className="font-medium">{formatFileSize(size)}</span>
            </div>
          </>
        )}

        {/* MIME type */}
        {mimeType && (
          <>
            <span className="text-muted-foreground/50">•</span>
            <div className="flex items-center gap-1">
              <span className="font-mono">{mimeType}</span>
            </div>
          </>
        )}

        {/* Last modified */}
        {createdAt && (
          <>
            <span className="text-muted-foreground/50">•</span>
            <div className="flex items-center gap-1">
              <span>Modified {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
