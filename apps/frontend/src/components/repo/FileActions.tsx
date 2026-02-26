import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Copy, Download, ExternalLink, Check, Share2 } from 'lucide-react';
import { buildPublicUrl } from '@/lib/utils';

interface FileActionsProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  /** MIME type for download */
  mimeType?: string;
  /** Optional callback for download */
  onDownload?: () => void;
}

export function FileActions({
  owner,
  repo,
  gitRef,
  filepath,
  onDownload,
}: FileActionsProps) {
  const [copied, setCopied] = useState(false);

  // Build URLs
  // In development, use relative path (proxied by Vite to localhost:3000)
  // In production, VITE_API_URL can be set or use relative path
  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const publicUrl = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);
  const rawUrl = publicUrl; // Same URL for raw view

  // Copy public URL to clipboard
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  // Download file
  const handleDownload = async () => {
    if (onDownload) {
      onDownload();
      return;
    }

    try {
      const response = await fetch(publicUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filepath.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  };

  // View raw in new tab
  const handleViewRaw = () => {
    window.open(rawUrl, '_blank', 'noopener,noreferrer');
  };

  // Share (Web Share API if available)
  const handleShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: filepath,
          url: publicUrl,
        });
      } catch (err) {
        // User cancelled or error occurred
        console.log('Share failed or cancelled:', err);
      }
    } else {
      // Fallback: copy URL
      handleCopyUrl();
    }
  };

  // Check if Web Share API is supported
  const isShareSupported = typeof navigator.share === 'function';

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 px-4 py-2 border-t bg-muted/30">
        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyUrl}
                className="h-8 gap-2"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy URL'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy public URL</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="h-8 gap-2"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download file</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleViewRaw}
                className="h-8 gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">View Raw</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>View raw file in new tab</TooltipContent>
          </Tooltip>

          {/* Share button - only show if Web Share API is available */}
          {isShareSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShare}
                  className="h-8 gap-2"
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Share file</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
