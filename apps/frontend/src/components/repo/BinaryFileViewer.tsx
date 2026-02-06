import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileArchive, File, ExternalLink } from 'lucide-react';
import { buildPublicUrl } from '@/lib/utils';

interface BinaryFileViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  fileSize?: number;
  mimeType?: string;
}

/**
 * Formats file size in human-readable format
 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return 'Unknown size';
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Gets the file type description from MIME type or extension
 */
function getFileTypeDescription(filepath: string, mimeType?: string): string {
  const extension = filepath.split('.').pop()?.toLowerCase();

  // Common file type descriptions
  const descriptions: Record<string, string> = {
    zip: 'ZIP Archive',
    rar: 'RAR Archive',
    '7z': '7-Zip Archive',
    tar: 'TAR Archive',
    gz: 'Gzip Archive',
    tgz: 'Gzip Compressed TAR',
    pdf: 'PDF Document',
    doc: 'Word Document',
    docx: 'Word Document',
    xls: 'Excel Spreadsheet',
    xlsx: 'Excel Spreadsheet',
    ppt: 'PowerPoint Presentation',
    pptx: 'PowerPoint Presentation',
    exe: 'Windows Executable',
    dmg: 'macOS Disk Image',
    jar: 'Java Archive',
    mp3: 'MP3 Audio',
    mp4: 'MP4 Video',
    wav: 'WAV Audio',
    avi: 'AVI Video',
    mkv: 'MKV Video',
    ttf: 'TrueType Font',
    otf: 'OpenType Font',
    woff: 'Web Font',
    woff2: 'Web Font 2',
  };

  if (extension && descriptions[extension]) {
    return descriptions[extension];
  }

  if (mimeType) {
    if (mimeType.startsWith('application/zip')) return 'ZIP Archive';
    if (mimeType.startsWith('audio/')) return 'Audio File';
    if (mimeType.startsWith('video/')) return 'Video File';
    if (mimeType.startsWith('font/')) return 'Font File';
  }

  return 'Binary File';
}

/**
 * Gets an appropriate icon for the file type
 */
function getFileIcon(filepath: string, mimeType?: string) {
  const extension = filepath.split('.').pop()?.toLowerCase();

  // Archives get the archive icon
  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'war'];
  if (archiveExtensions.includes(extension || '')) {
    return FileArchive;
  }

  if (mimeType?.includes('zip') || mimeType?.includes('archive')) {
    return FileArchive;
  }

  return File;
}

export function BinaryFileViewer({
  owner,
  repo,
  gitRef,
  filepath,
  fileSize,
  mimeType,
}: BinaryFileViewerProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  // Build the public URL for the file
  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const fileUrl = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);

  const filename = filepath.split('/').pop() || 'file';
  const fileType = getFileTypeDescription(filepath, mimeType);
  const FileIcon = getFileIcon(filepath, mimeType);

  // Download file
  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      const response = await fetch(fileUrl, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Open in new tab (will trigger browser's native download for most binary files)
  const handleOpenInNewTab = () => {
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <div className="flex-1 text-xs text-muted-foreground">
          {fileType}
          {' • '}
          {formatFileSize(fileSize)}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md space-y-6">
          <div className="flex justify-center">
            <div className="p-4 rounded-full bg-muted">
              <FileIcon className="h-12 w-12 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">{filename}</h3>
            <p className="text-sm text-muted-foreground">
              {fileType} • {formatFileSize(fileSize)}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This file cannot be displayed in the browser.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button
                onClick={handleDownload}
                disabled={isDownloading}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {isDownloading ? 'Downloading...' : 'Download File'}
              </Button>

              <Button
                variant="outline"
                onClick={handleOpenInNewTab}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open in New Tab
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
