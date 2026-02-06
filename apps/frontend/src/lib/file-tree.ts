/**
 * File tree utilities for converting flat file lists to hierarchical tree structures
 */

export interface FileMetadata {
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
  isPublic: boolean;
  createdAt: string;
}

export interface FileNode {
  type: 'file';
  name: string;
  path: string;
  metadata: FileMetadata;
}

export interface DirectoryNode {
  type: 'directory';
  name: string;
  path: string;
  children: TreeNode[];
  expanded?: boolean;
}

export type TreeNode = FileNode | DirectoryNode;

/**
 * Build a hierarchical tree structure from a flat list of files
 * @param files Flat array of file metadata
 * @returns Root-level tree nodes (folders first, then files)
 */
export function buildFileTree(files: FileMetadata[]): TreeNode[] {
  const root: Map<string, TreeNode> = new Map();

  // Sort files by path for consistent processing
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const segments = file.path.split('/').filter(Boolean);
    let currentMap = root;
    let currentPath = '';

    // Process each segment of the path
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLastSegment = i === segments.length - 1;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (isLastSegment) {
        // This is a file
        const fileNode: FileNode = {
          type: 'file',
          name: segment,
          path: currentPath,
          metadata: file,
        };
        currentMap.set(segment, fileNode);
      } else {
        // This is a directory
        if (!currentMap.has(segment)) {
          const dirNode: DirectoryNode = {
            type: 'directory',
            name: segment,
            path: currentPath,
            children: [],
            expanded: false,
          };
          currentMap.set(segment, dirNode);
        }

        // Navigate into the directory
        const dirNode = currentMap.get(segment) as DirectoryNode;
        currentMap = new Map(dirNode.children.map((node) => [node.name, node]));

        // Update the parent's children array
        const parentNode = findNodeByPath(Array.from(root.values()), currentPath);
        if (parentNode && parentNode.type === 'directory') {
          currentMap = new Map(parentNode.children.map((node) => [node.name, node]));
        }
      }
    }
  }

  // Convert map to sorted array and recursively sort children
  return sortTreeNodes(Array.from(root.values()));
}

/**
 * Recursively build tree structure (cleaner implementation)
 */
export function buildFileTreeRecursive(files: FileMetadata[]): TreeNode[] {
  const root: DirectoryNode = {
    type: 'directory',
    name: '',
    path: '',
    children: [],
    expanded: false,
  };

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    let currentDir = root;
    let currentPath = '';

    // Navigate/create directory structure
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLastSegment = i === segments.length - 1;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (isLastSegment) {
        // Add file node
        const fileNode: FileNode = {
          type: 'file',
          name: segment,
          path: currentPath,
          metadata: file,
        };
        currentDir.children.push(fileNode);
      } else {
        // Find or create directory node
        let dirNode = currentDir.children.find(
          (child) => child.type === 'directory' && child.name === segment,
        ) as DirectoryNode | undefined;

        if (!dirNode) {
          dirNode = {
            type: 'directory',
            name: segment,
            path: currentPath,
            children: [],
            expanded: false,
          };
          currentDir.children.push(dirNode);
        }

        currentDir = dirNode;
      }
    }
  }

  // Sort and return root children
  return sortTreeNodes(root.children);
}

/**
 * Sort tree nodes: directories first (alphabetically), then files (alphabetically)
 */
export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    // Directories come before files
    if (a.type === 'directory' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'directory') return 1;

    // Within same type, sort alphabetically (case-insensitive)
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  // Recursively sort children of directories
  return sorted.map((node) => {
    if (node.type === 'directory') {
      return {
        ...node,
        children: sortTreeNodes(node.children),
      };
    }
    return node;
  });
}

/**
 * Find a node by its path in the tree
 */
export function findNodeByPath(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    if (node.type === 'directory') {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Flatten tree back to list of all files (useful for search)
 */
export function flattenTree(nodes: TreeNode[]): FileNode[] {
  const files: FileNode[] = [];

  for (const node of nodes) {
    if (node.type === 'file') {
      files.push(node);
    } else {
      files.push(...flattenTree(node.children));
    }
  }

  return files;
}

/**
 * Count total files in tree
 */
export function countFiles(nodes: TreeNode[]): number {
  let count = 0;

  for (const node of nodes) {
    if (node.type === 'file') {
      count++;
    } else {
      count += countFiles(node.children);
    }
  }

  return count;
}

/**
 * Get all directory paths in tree
 */
export function getAllDirectories(nodes: TreeNode[]): string[] {
  const directories: string[] = [];

  for (const node of nodes) {
    if (node.type === 'directory') {
      directories.push(node.path);
      directories.push(...getAllDirectories(node.children));
    }
  }

  return directories;
}

/**
 * Expand all directories in tree (useful for search results)
 */
export function expandAllDirectories(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === 'directory') {
      return {
        ...node,
        expanded: true,
        children: expandAllDirectories(node.children),
      };
    }
    return node;
  });
}

/**
 * Collapse all directories in tree
 */
export function collapseAllDirectories(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === 'directory') {
      return {
        ...node,
        expanded: false,
        children: collapseAllDirectories(node.children),
      };
    }
    return node;
  });
}

/**
 * Toggle directory expanded state
 */
export function toggleDirectory(nodes: TreeNode[], path: string): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path && node.type === 'directory') {
      return {
        ...node,
        expanded: !node.expanded,
      };
    }

    if (node.type === 'directory') {
      return {
        ...node,
        children: toggleDirectory(node.children, path),
      };
    }

    return node;
  });
}

/**
 * Filter tree by search query (case-insensitive, matches file/folder names)
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;

  const lowerQuery = query.toLowerCase();
  const filtered: TreeNode[] = [];

  for (const node of nodes) {
    if (node.type === 'file') {
      // Include file if it matches
      if (node.name.toLowerCase().includes(lowerQuery)) {
        filtered.push(node);
      }
    } else {
      // For directories, recursively filter children
      const filteredChildren = filterTree(node.children, query);

      // Include directory if it matches or has matching children
      if (node.name.toLowerCase().includes(lowerQuery) || filteredChildren.length > 0) {
        filtered.push({
          ...node,
          children: filteredChildren,
          expanded: filteredChildren.length > 0, // Auto-expand if has matching children
        });
      }
    }
  }

  return filtered;
}

/**
 * Get a flat list of all visible node paths in the tree
 * (respecting expanded state for directories)
 * Returns paths in the order they appear visually
 */
export function getFlattenedVisibleNodes(nodes: TreeNode[], expandedPaths: Set<string>): string[] {
  const result: string[] = [];

  function traverse(nodeList: TreeNode[]) {
    for (const node of nodeList) {
      result.push(node.path);

      // If it's an expanded directory, add its children
      if (node.type === 'directory' && expandedPaths.has(node.path) && node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return result;
}
