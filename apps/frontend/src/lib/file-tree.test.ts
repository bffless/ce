import { describe, it, expect } from 'vitest';
import {
  buildFileTreeRecursive,
  sortTreeNodes,
  findNodeByPath,
  flattenTree,
  countFiles,
  getAllDirectories,
  expandAllDirectories,
  collapseAllDirectories,
  toggleDirectory,
  filterTree,
  type FileMetadata,
  type TreeNode,
  type FileNode,
  type DirectoryNode,
} from './file-tree';

const mockFiles: FileMetadata[] = [
  {
    path: 'index.html',
    fileName: 'index.html',
    size: 100,
    mimeType: 'text/html',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'css/style.css',
    fileName: 'style.css',
    size: 50,
    mimeType: 'text/css',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'css/theme.css',
    fileName: 'theme.css',
    size: 30,
    mimeType: 'text/css',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'js/app.js',
    fileName: 'app.js',
    size: 200,
    mimeType: 'application/javascript',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'images/logo.png',
    fileName: 'logo.png',
    size: 5000,
    mimeType: 'image/png',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    path: 'assets/fonts/roboto.ttf',
    fileName: 'roboto.ttf',
    size: 10000,
    mimeType: 'font/ttf',
    isPublic: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
];

describe('file-tree utilities', () => {
  describe('buildFileTreeRecursive', () => {
    it('should convert flat file list to tree structure', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      // Should have 5 root items: 1 file + 4 directories
      expect(tree).toHaveLength(5);

      // Check root file
      const indexFile = tree.find((node) => node.name === 'index.html');
      expect(indexFile).toBeDefined();
      expect(indexFile?.type).toBe('file');

      // Check directories exist
      const cssDir = tree.find((node) => node.name === 'css') as DirectoryNode;
      const jsDir = tree.find((node) => node.name === 'js') as DirectoryNode;
      const imagesDir = tree.find((node) => node.name === 'images') as DirectoryNode;
      const assetsDir = tree.find((node) => node.name === 'assets') as DirectoryNode;

      expect(cssDir?.type).toBe('directory');
      expect(jsDir?.type).toBe('directory');
      expect(imagesDir?.type).toBe('directory');
      expect(assetsDir?.type).toBe('directory');

      // Check css directory has 2 files
      expect(cssDir.children).toHaveLength(2);
    });

    it('should sort directories before files', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      // First 4 should be directories, last should be file
      expect(tree[0].type).toBe('directory');
      expect(tree[1].type).toBe('directory');
      expect(tree[2].type).toBe('directory');
      expect(tree[3].type).toBe('directory');
      expect(tree[4].type).toBe('file');
    });

    it('should sort items alphabetically within same type', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      const directories = tree.filter((node) => node.type === 'directory');
      expect(directories[0].name).toBe('assets');
      expect(directories[1].name).toBe('css');
      expect(directories[2].name).toBe('images');
    });

    it('should handle nested directories', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      const assetsDir = tree.find((node) => node.name === 'assets') as DirectoryNode;
      expect(assetsDir).toBeDefined();
      expect(assetsDir.children).toHaveLength(1);

      const fontsDir = assetsDir.children[0] as DirectoryNode;
      expect(fontsDir.name).toBe('fonts');
      expect(fontsDir.type).toBe('directory');
      expect(fontsDir.children).toHaveLength(1);

      const fontFile = fontsDir.children[0] as FileNode;
      expect(fontFile.name).toBe('roboto.ttf');
      expect(fontFile.type).toBe('file');
    });

    it('should preserve file metadata', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      const indexFile = tree.find((node) => node.name === 'index.html') as FileNode;
      expect(indexFile.metadata.size).toBe(100);
      expect(indexFile.metadata.mimeType).toBe('text/html');
      expect(indexFile.metadata.isPublic).toBe(true);
    });

    it('should handle empty file list', () => {
      const tree = buildFileTreeRecursive([]);
      expect(tree).toHaveLength(0);
    });

    it('should handle single file', () => {
      const tree = buildFileTreeRecursive([mockFiles[0]]);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('file');
      expect(tree[0].name).toBe('index.html');
    });

    it('should set expanded to false by default', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const cssDir = tree.find((node) => node.name === 'css') as DirectoryNode;
      expect(cssDir.expanded).toBe(false);
    });
  });

  describe('findNodeByPath', () => {
    it('should find root-level file', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const node = findNodeByPath(tree, 'index.html');

      expect(node).toBeDefined();
      expect(node?.name).toBe('index.html');
      expect(node?.type).toBe('file');
    });

    it('should find nested file', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const node = findNodeByPath(tree, 'css/style.css');

      expect(node).toBeDefined();
      expect(node?.name).toBe('style.css');
      expect(node?.type).toBe('file');
    });

    it('should find directory', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const node = findNodeByPath(tree, 'css');

      expect(node).toBeDefined();
      expect(node?.name).toBe('css');
      expect(node?.type).toBe('directory');
    });

    it('should find deeply nested directory', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const node = findNodeByPath(tree, 'assets/fonts');

      expect(node).toBeDefined();
      expect(node?.name).toBe('fonts');
      expect(node?.type).toBe('directory');
    });

    it('should return null for non-existent path', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const node = findNodeByPath(tree, 'nonexistent.txt');

      expect(node).toBeNull();
    });
  });

  describe('flattenTree', () => {
    it('should convert tree back to flat list of files', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const files = flattenTree(tree);

      expect(files).toHaveLength(6); // All 6 files from mockFiles
      files.forEach((file) => {
        expect(file.type).toBe('file');
      });
    });

    it('should preserve file paths', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const files = flattenTree(tree);

      const paths = files.map((f) => f.path);
      expect(paths).toContain('index.html');
      expect(paths).toContain('css/style.css');
      expect(paths).toContain('assets/fonts/roboto.ttf');
    });

    it('should return empty array for empty tree', () => {
      const files = flattenTree([]);
      expect(files).toHaveLength(0);
    });
  });

  describe('countFiles', () => {
    it('should count all files in tree', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const count = countFiles(tree);

      expect(count).toBe(6);
    });

    it('should return 0 for empty tree', () => {
      const count = countFiles([]);
      expect(count).toBe(0);
    });

    it('should count only files, not directories', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const fileCount = countFiles(tree);
      const totalNodes = tree.length;

      expect(fileCount).toBe(6);
      expect(totalNodes).toBe(5); // 4 dirs + 1 file at root
    });
  });

  describe('getAllDirectories', () => {
    it('should return all directory paths', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const directories = getAllDirectories(tree);

      expect(directories).toContain('css');
      expect(directories).toContain('js');
      expect(directories).toContain('images');
      expect(directories).toContain('assets');
      expect(directories).toContain('assets/fonts');
      expect(directories).toHaveLength(5);
    });

    it('should return empty array for tree with no directories', () => {
      const singleFileTree = buildFileTreeRecursive([mockFiles[0]]);
      const directories = getAllDirectories(singleFileTree);

      expect(directories).toHaveLength(0);
    });
  });

  describe('expandAllDirectories', () => {
    it('should set expanded=true for all directories', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const expanded = expandAllDirectories(tree);

      const checkExpanded = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (node.type === 'directory') {
            expect(node.expanded).toBe(true);
            checkExpanded(node.children);
          }
        });
      };

      checkExpanded(expanded);
    });

    it('should not modify files', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const expanded = expandAllDirectories(tree);
      const files = flattenTree(expanded);

      expect(files).toHaveLength(6);
    });
  });

  describe('collapseAllDirectories', () => {
    it('should set expanded=false for all directories', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const expanded = expandAllDirectories(tree);
      const collapsed = collapseAllDirectories(expanded);

      const checkCollapsed = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (node.type === 'directory') {
            expect(node.expanded).toBe(false);
            checkCollapsed(node.children);
          }
        });
      };

      checkCollapsed(collapsed);
    });
  });

  describe('toggleDirectory', () => {
    it('should toggle expanded state of specific directory', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      // Initially collapsed
      const cssDir = findNodeByPath(tree, 'css') as DirectoryNode;
      expect(cssDir.expanded).toBe(false);

      // Toggle to expanded
      const toggled1 = toggleDirectory(tree, 'css');
      const cssDirExpanded = findNodeByPath(toggled1, 'css') as DirectoryNode;
      expect(cssDirExpanded.expanded).toBe(true);

      // Toggle back to collapsed
      const toggled2 = toggleDirectory(toggled1, 'css');
      const cssDirCollapsed = findNodeByPath(toggled2, 'css') as DirectoryNode;
      expect(cssDirCollapsed.expanded).toBe(false);
    });

    it('should toggle nested directory', () => {
      const tree = buildFileTreeRecursive(mockFiles);

      const toggled = toggleDirectory(tree, 'assets/fonts');
      const fontsDir = findNodeByPath(toggled, 'assets/fonts') as DirectoryNode;

      expect(fontsDir.expanded).toBe(true);
    });

    it('should not affect other directories', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const toggled = toggleDirectory(tree, 'css');

      const jsDir = findNodeByPath(toggled, 'js') as DirectoryNode;
      expect(jsDir.expanded).toBe(false);
    });
  });

  describe('filterTree', () => {
    it('should filter files by name', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'style');

      const files = flattenTree(filtered);
      expect(files.length).toBeGreaterThan(0);

      files.forEach((file) => {
        expect(file.name.toLowerCase()).toContain('style');
      });
    });

    it('should include parent directories of matching files', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'style');

      // Should include 'css' directory
      const cssDir = filtered.find((node) => node.name === 'css');
      expect(cssDir).toBeDefined();
      expect(cssDir?.type).toBe('directory');
    });

    it('should auto-expand directories with matching children', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'roboto');

      const assetsDir = filtered.find((node) => node.name === 'assets') as DirectoryNode;
      expect(assetsDir?.expanded).toBe(true);

      const fontsDir = assetsDir?.children[0] as DirectoryNode;
      expect(fontsDir?.expanded).toBe(true);
    });

    it('should return full tree when query is empty', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, '');

      expect(filtered).toEqual(tree);
    });

    it('should return full tree when query is whitespace', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, '   ');

      expect(filtered).toEqual(tree);
    });

    it('should be case-insensitive', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered1 = filterTree(tree, 'CSS');
      const filtered2 = filterTree(tree, 'css');

      expect(flattenTree(filtered1).length).toBe(flattenTree(filtered2).length);
    });

    it('should return empty array when no matches', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'nonexistent');

      expect(filtered).toHaveLength(0);
    });

    it('should match directory names', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'assets');

      expect(filtered.length).toBeGreaterThan(0);
      const assetsDir = filtered.find((node) => node.name === 'assets');
      expect(assetsDir).toBeDefined();
    });

    it('should include all children of matching directory', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const filtered = filterTree(tree, 'css');

      const cssDir = filtered.find((node) => node.name === 'css') as DirectoryNode;
      expect(cssDir.children.length).toBeGreaterThan(0);
    });
  });

  describe('sortTreeNodes', () => {
    it('should sort directories before files', () => {
      const unsorted: TreeNode[] = [
        {
          type: 'file',
          name: 'file1.txt',
          path: 'file1.txt',
          metadata: mockFiles[0],
        },
        {
          type: 'directory',
          name: 'folder1',
          path: 'folder1',
          children: [],
        },
        {
          type: 'file',
          name: 'file2.txt',
          path: 'file2.txt',
          metadata: mockFiles[0],
        },
      ];

      const sorted = sortTreeNodes(unsorted);

      expect(sorted[0].type).toBe('directory');
      expect(sorted[1].type).toBe('file');
      expect(sorted[2].type).toBe('file');
    });

    it('should sort alphabetically within same type', () => {
      const unsorted: TreeNode[] = [
        {
          type: 'directory',
          name: 'zebra',
          path: 'zebra',
          children: [],
        },
        {
          type: 'directory',
          name: 'apple',
          path: 'apple',
          children: [],
        },
        {
          type: 'file',
          name: 'z.txt',
          path: 'z.txt',
          metadata: mockFiles[0],
        },
        {
          type: 'file',
          name: 'a.txt',
          path: 'a.txt',
          metadata: mockFiles[0],
        },
      ];

      const sorted = sortTreeNodes(unsorted);

      expect(sorted[0].name).toBe('apple');
      expect(sorted[1].name).toBe('zebra');
      expect(sorted[2].name).toBe('a.txt');
      expect(sorted[3].name).toBe('z.txt');
    });

    it('should recursively sort children', () => {
      const tree = buildFileTreeRecursive(mockFiles);
      const cssDir = tree.find((node) => node.name === 'css') as DirectoryNode;

      // CSS children should be sorted
      expect(cssDir.children[0].name).toBe('style.css');
      expect(cssDir.children[1].name).toBe('theme.css');
    });

    it('should be case-insensitive', () => {
      const unsorted: TreeNode[] = [
        {
          type: 'file',
          name: 'Zebra.txt',
          path: 'Zebra.txt',
          metadata: mockFiles[0],
        },
        {
          type: 'file',
          name: 'apple.txt',
          path: 'apple.txt',
          metadata: mockFiles[0],
        },
      ];

      const sorted = sortTreeNodes(unsorted);

      expect(sorted[0].name).toBe('apple.txt');
      expect(sorted[1].name).toBe('Zebra.txt');
    });
  });
});