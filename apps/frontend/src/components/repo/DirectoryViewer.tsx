import { useMemo, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Folder, File, FileText, FileCode, Image as ImageIcon } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import type { FileItem } from '@/services/repoApi';
import { ViewHeader } from './ViewHeader';

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  fileCount?: number;
  mimeType?: string;
}

interface DirectoryViewerProps {
  files: FileItem[];
  currentPath: string;
  owner: string;
  repo: string;
  gitRef: string;
  /** Optional left-side actions to render before the title (e.g., hamburger menu) */
  leftActions?: ReactNode;
}

/**
 * Extracts the direct children (files and folders) of a directory
 */
function extractDirectoryContents(
  files: FileItem[],
  dirPath: string,
): DirectoryEntry[] {
  const normalizedDirPath = dirPath ? dirPath.replace(/\/$/, '') + '/' : '';
  const entries = new Map<string, DirectoryEntry>();

  for (const file of files) {
    // Skip files that aren't in this directory
    if (normalizedDirPath && !file.path.startsWith(normalizedDirPath)) {
      continue;
    }

    // Get the relative path from the current directory
    const relativePath = normalizedDirPath
      ? file.path.substring(normalizedDirPath.length)
      : file.path;

    // Skip if empty (shouldn't happen, but defensive)
    if (!relativePath) continue;

    // Check if this is a direct child or nested deeper
    const pathParts = relativePath.split('/');
    const isDirectChild = pathParts.length === 1;

    if (isDirectChild) {
      // Direct file
      entries.set(file.path, {
        name: file.fileName,
        type: 'file',
        path: file.path,
        size: file.size,
        mimeType: file.mimeType,
      });
    } else {
      // Nested file - add/update the parent directory
      const dirName = pathParts[0];
      const dirFullPath = normalizedDirPath + dirName;

      if (!entries.has(dirFullPath)) {
        entries.set(dirFullPath, {
          name: dirName,
          type: 'directory',
          path: dirFullPath,
          fileCount: 0,
        });
      }

      const entry = entries.get(dirFullPath)!;
      entry.fileCount = (entry.fileCount || 0) + 1;
    }
  }

  // Convert to array and sort: directories first, then files, alphabetically
  return Array.from(entries.values()).sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Returns an appropriate icon for a file based on its MIME type
 */
function getFileIcon(mimeType?: string) {
  if (!mimeType) return FileText;

  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('text/')) return FileText;
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('html')
  ) {
    return FileCode;
  }

  return File;
}

export function DirectoryViewer({
  files,
  currentPath,
  owner,
  repo,
  gitRef,
  leftActions,
}: DirectoryViewerProps) {
  const entries = useMemo(
    () => extractDirectoryContents(files, currentPath),
    [files, currentPath],
  );

  const totalFiles = useMemo(() => {
    const prefix = currentPath ? currentPath.replace(/\/$/, '') + '/' : '';
    return files.filter((f) => !prefix || f.path.startsWith(prefix)).length;
  }, [files, currentPath]);

  if (entries.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader
          title={currentPath || 'Root Directory'}
          icon={<Folder className="h-4 w-4" />}
          leftActions={leftActions}
        />
        <div className="flex-1 overflow-auto p-6">
          <div className="rounded-lg border bg-card p-8 text-center">
            <Folder className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Empty Directory</h3>
            <p className="text-sm text-muted-foreground">
              This directory doesn't contain any files.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title={currentPath || 'Root Directory'}
        icon={<Folder className="h-4 w-4" />}
        leftActions={leftActions}
        rightActions={
          <span className="text-xs text-muted-foreground">
            {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
          </span>
        }
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-lg border bg-card">

        {/* Directory listing */}
        <div className="divide-y">
          {entries.map((entry) => {
            const linkPath = `/repo/${owner}/${repo}/${gitRef}/${entry.path}`;
            const Icon = entry.type === 'directory' ? Folder : getFileIcon(entry.mimeType);

            return (
              <Link
                key={entry.path}
                to={linkPath}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group"
              >
                {/* Icon */}
                <div className="shrink-0">
                  <Icon
                    className={`h-4 w-4 ${
                      entry.type === 'directory'
                        ? 'text-blue-500'
                        : 'text-muted-foreground'
                    }`}
                  />
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium group-hover:text-primary transition-colors">
                    {entry.name}
                  </span>
                </div>

                {/* Size or file count */}
                <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {entry.type === 'directory' ? (
                    <span>
                      {entry.fileCount} {entry.fileCount === 1 ? 'file' : 'files'}
                    </span>
                  ) : (
                    <span>{formatFileSize(entry.size || 0)}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

