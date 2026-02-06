import { ChevronRight, ChevronDown, Globe } from 'lucide-react';
import { TreeNode as TreeNodeType } from '@/lib/file-tree';
import { FileIcon } from './FileIcon';
import { cn } from '@/lib/utils';

export interface TreeNodeProps {
  node: TreeNodeType;
  level: number;
  isActive: boolean;
  expandedPaths: Set<string>;
  onSelect: (path: string, isDirectory: boolean, hasIndexHtml: boolean) => void;
  onToggleExpand: (path: string) => void;
  currentFilePath?: string;
}

/**
 * Check if a directory node has an index.html file as a direct child
 */
function hasIndexHtml(node: TreeNodeType): boolean {
  if (node.type !== 'directory') return false;
  return node.children.some(
    (child) => child.type === 'file' && child.name.toLowerCase() === 'index.html'
  );
}

/**
 * TreeNode component - renders a single node in the file tree
 * Handles both files and directories recursively
 */
export function TreeNode({
  node,
  level,
  isActive,
  expandedPaths,
  onSelect,
  onToggleExpand,
  currentFilePath,
}: TreeNodeProps) {
  const isDirectory = node.type === 'directory';
  const isExpanded = isDirectory && expandedPaths.has(node.path);
  const directoryHasIndexHtml = isDirectory && hasIndexHtml(node);

  const handleClick = () => {
    // For both files and directories, call onSelect
    // The parent component decides what to do based on isDirectory and hasIndexHtml
    onSelect(node.path, isDirectory, directoryHasIndexHtml);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.path);
  };

  const handleChevronKeyDown = (e: React.KeyboardEvent) => {
    // Handle Enter and Space keys for accessibility
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onToggleExpand(node.path);
    }
  };

  return (
    <div role="group">
      <button
        type="button"
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-selected={isActive}
        data-path={node.path}
        onClick={handleClick}
        className={cn(
          'w-full text-left border-0 bg-transparent',
          'flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer rounded-md mb-0.5',
          'hover:bg-accent hover:text-accent-foreground transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          isActive && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{
          paddingLeft: `${level * 12 + 8}px`,
        }}
      >
        {/* Expand/collapse chevron for directories */}
        {isDirectory ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleChevronClick}
            onKeyDown={handleChevronKeyDown}
            className="flex items-center justify-center w-4 h-4 hover:bg-accent-foreground/10 rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </span>
        ) : (
          <div className="w-4" />
        )}

        {/* File/folder icon */}
        <FileIcon
          fileName={node.name}
          isDirectory={isDirectory}
          isOpen={isExpanded}
          size={16}
          className="shrink-0"
        />

        {/* File/folder name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Globe icon for directories with index.html (servable as website) */}
        {directoryHasIndexHtml && (
          <span title="Contains index.html">
            <Globe size={12} className="text-muted-foreground shrink-0" />
          </span>
        )}

        {/* File size for files (optional) */}
        {!isDirectory && node.metadata.size && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatFileSize(node.metadata.size)}
          </span>
        )}
      </button>

      {/* Recursively render children for expanded directories */}
      {isDirectory && isExpanded && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              isActive={currentFilePath === child.path}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              currentFilePath={currentFilePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}