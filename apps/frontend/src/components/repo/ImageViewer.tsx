import { useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buildPublicUrl } from '@/lib/utils';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface ImageViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  /** File size in bytes */
  fileSize?: number;
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

export function ImageViewer({ owner, repo, gitRef, filepath, fileSize }: ImageViewerProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [imageKey, setImageKey] = useState(0); // For forcing reload

  // Build the public URL for the image
  // In development, use relative path (proxied by Vite to localhost:3000)
  // In production, VITE_API_URL can be set or use relative path
  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const imageSrc = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);

  // Handle image load
  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    setIsLoading(false);
    setHasError(false);
  };

  // Handle image error
  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  // Download image
  const handleDownload = async () => {
    try {
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filepath.split('/').pop() || 'image';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download image:', err);
    }
  };

  // Open in new tab
  const handleOpenInNewTab = () => {
    window.open(imageSrc, '_blank', 'noopener,noreferrer');
  };

  // Retry loading
  const handleRetry = () => {
    setIsLoading(true);
    setHasError(false);
    setImageKey((prev) => prev + 1); // Force reload
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <div className="flex-1 text-xs text-muted-foreground">
          {dimensions && (
            <span>
              {dimensions.width} × {dimensions.height}
            </span>
          )}
          {fileSize && dimensions && <span className="mx-2">•</span>}
          {fileSize && <span>{formatFileSize(fileSize)}</span>}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            title="Download image"
            className="h-7 px-2"
          >
            <Download className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenInNewTab}
            title="Open in new tab"
            className="h-7 px-2"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Image viewer content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Loading state */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-3 w-full max-w-md p-8">
              <Skeleton className="w-full h-64 rounded-lg" />
              <span className="text-sm text-muted-foreground">Loading image...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10 p-8">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">Failed to load image</p>
                    <p className="text-sm mt-1">
                      The image may be corrupted or the file type is not supported.
                    </p>
                  </div>
                  <Button onClick={handleRetry} size="sm" variant="outline" className="w-fit">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Try Again
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Zoom controls and image */}
        <TransformWrapper
          initialScale={1}
          minScale={0.1}
          maxScale={10}
          centerOnInit
          wheel={{ step: 0.1 }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <div className="h-full flex flex-col">
              {/* Zoom controls */}
              <div className="absolute top-4 right-4 z-20 flex flex-col gap-1 bg-background/90 rounded-md p-1 border shadow-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => zoomIn()}
                  title="Zoom in"
                  className="h-8 w-8 p-0"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => zoomOut()}
                  title="Zoom out"
                  className="h-8 w-8 p-0"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => resetTransform()}
                  title="Reset zoom"
                  className="h-8 w-8 p-0"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              {/* Image with pan capability */}
              <TransformComponent
                wrapperClass="!w-full !h-full"
                contentClass="!w-full !h-full flex items-center justify-center"
              >
                <div className="image-viewer-checkerboard inline-block">
                  <img
                    key={imageKey}
                    src={imageSrc}
                    alt={filepath}
                    onLoad={handleLoad}
                    onError={handleError}
                    className="max-w-none"
                    style={{ display: hasError ? 'none' : 'block' }}
                  />
                </div>
              </TransformComponent>
            </div>
          )}
        </TransformWrapper>
      </div>

      <style>{`
        .image-viewer-checkerboard {
          background-image:
            linear-gradient(45deg, hsl(var(--muted) / 0.3) 25%, transparent 25%),
            linear-gradient(-45deg, hsl(var(--muted) / 0.3) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, hsl(var(--muted) / 0.3) 75%),
            linear-gradient(-45deg, transparent 75%, hsl(var(--muted) / 0.3) 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          background-color: hsl(var(--background));
        }
      `}</style>
    </div>
  );
}
