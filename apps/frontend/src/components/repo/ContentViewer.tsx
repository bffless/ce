import { BrowserTabs } from './BrowserTabs';
import { CodeViewer } from './CodeViewer';
import { HtmlPreview } from './HtmlPreview';
import { ImageViewer } from './ImageViewer';
import { BinaryFileViewer } from './BinaryFileViewer';
import { MarkdownViewer } from './MarkdownViewer';
import { FileMetadata } from './FileMetadata';
import { FileActions } from './FileActions';
import { FileItem } from '@/services/repoApi';

interface ContentViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  /** File metadata from the file tree API */
  fileData?: FileItem;
  /** Optional left-side actions to render before the tabs */
  leftActions?: React.ReactNode;
}

/**
 * Determines if a file is an image based on MIME type or extension
 */
function isImageFile(filepath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('image/')) return true;

  const extension = filepath.split('.').pop()?.toLowerCase();
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  return imageExtensions.includes(extension || '');
}

/**
 * Determines if a file is HTML
 * Also returns true for directory paths ending with '/' (will serve index.html)
 */
function isHtmlFile(filepath: string, mimeType?: string): boolean {
  if (mimeType === 'text/html') return true;

  // Directory paths ending with '/' will serve index.html
  if (filepath.endsWith('/')) return true;

  const extension = filepath.split('.').pop()?.toLowerCase();
  return extension === 'html' || extension === 'htm';
}

/**
 * Determines if a file is Markdown
 */
function isMarkdownFile(filepath: string, mimeType?: string): boolean {
  if (mimeType === 'text/markdown') return true;

  const extension = filepath.split('.').pop()?.toLowerCase();
  return extension === 'md' || extension === 'mdx';
}

/**
 * Determines if a file is a binary file that cannot be displayed as text
 * These files should show a download prompt instead of code/preview
 */
function isBinaryFile(filepath: string, mimeType?: string): boolean {
  // Check MIME type first
  if (mimeType) {
    // Common binary MIME types
    const binaryMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/gzip',
      'application/x-tar',
      'application/x-bzip2',
      'application/octet-stream',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/java-archive',
      'application/x-executable',
      'application/x-mach-binary',
      'application/x-deb',
      'application/x-rpm',
    ];

    if (binaryMimeTypes.some(type => mimeType.startsWith(type))) return true;

    // Audio and video are binary
    if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return true;

    // Font files are binary
    if (mimeType.startsWith('font/')) return true;
  }

  // Check file extension as fallback
  const extension = filepath.split('.').pop()?.toLowerCase();
  const binaryExtensions = [
    // Archives
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz',
    // Documents
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    // Executables
    'exe', 'dll', 'so', 'dylib', 'bin', 'dmg', 'app', 'deb', 'rpm',
    // Java/compiled
    'jar', 'war', 'class', 'pyc', 'pyo',
    // Audio
    'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
    // Video
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm',
    // Fonts
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    // Other binary
    'iso', 'img', 'sqlite', 'db',
  ];

  return binaryExtensions.includes(extension || '');
}

export function ContentViewer({ owner, repo, gitRef, filepath, fileData, leftActions }: ContentViewerProps) {
  const isImage = isImageFile(filepath, fileData?.mimeType);
  const isHtml = isHtmlFile(filepath, fileData?.mimeType);
  const isMarkdown = isMarkdownFile(filepath, fileData?.mimeType);
  const isBinary = isBinaryFile(filepath, fileData?.mimeType);

  return (
    <div className="h-full flex flex-col">
      <BrowserTabs
        filepath={filepath}
        leftActions={leftActions}
        codeContent={
          <div className="flex-1 min-h-0 flex flex-col">
            {isBinary ? (
              <BinaryFileViewer
                owner={owner}
                repo={repo}
                gitRef={gitRef}
                filepath={filepath}
                fileSize={fileData?.size}
                mimeType={fileData?.mimeType}
              />
            ) : (
              <CodeViewer
                owner={owner}
                repo={repo}
                gitRef={gitRef}
                filepath={filepath}
                mimeType={fileData?.mimeType}
              />
            )}
          </div>
        }
        previewContent={
          <div className="flex-1 min-h-0 flex flex-col">
            {isImage ? (
              <ImageViewer
                owner={owner}
                repo={repo}
                gitRef={gitRef}
                filepath={filepath}
                fileSize={fileData?.size}
              />
            ) : isHtml ? (
              <HtmlPreview owner={owner} repo={repo} gitRef={gitRef} filepath={filepath} />
            ) : isMarkdown ? (
              <MarkdownViewer owner={owner} repo={repo} gitRef={gitRef} filepath={filepath} />
            ) : isBinary ? (
              <BinaryFileViewer
                owner={owner}
                repo={repo}
                gitRef={gitRef}
                filepath={filepath}
                fileSize={fileData?.size}
                mimeType={fileData?.mimeType}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                  <p className="text-sm text-muted-foreground mb-2">No preview available</p>
                  <p className="text-xs text-muted-foreground">
                    Preview is only available for HTML, image, and Markdown files. Use the Code tab
                    to view the file contents.
                  </p>
                </div>
              </div>
            )}
          </div>
        }
        historyContent={
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <p className="text-sm text-muted-foreground mb-2">History view coming soon</p>
              <p className="text-xs text-muted-foreground">
                This will show the commit history for this file.
              </p>
            </div>
          </div>
        }
      />

      {/* File metadata footer */}
      {fileData && (
        <FileMetadata
          size={fileData.size}
          mimeType={fileData.mimeType}
          createdAt={fileData.createdAt}
        />
      )}

      {/* File actions toolbar */}
      <FileActions
        owner={owner}
        repo={repo}
        gitRef={gitRef}
        filepath={filepath}
        mimeType={fileData?.mimeType}
      />
    </div>
  );
}
