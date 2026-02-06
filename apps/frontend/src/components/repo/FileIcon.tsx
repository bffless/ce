import {
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image,
  FileJson,
  Database,
  FileArchive,
  File,
  Palette,
  FileCode2,
  Video,
  Music,
  FileType,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';

export interface FileIconProps {
  fileName: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  size?: number;
  className?: string;
}

interface IconConfig {
  icon: LucideIcon;
  color: string;
}

const EXTENSION_ICON_MAP: Record<string, IconConfig> = {
  // HTML
  html: { icon: FileCode, color: 'text-orange-500' },
  htm: { icon: FileCode, color: 'text-orange-500' },

  // Stylesheets
  css: { icon: Palette, color: 'text-blue-500' },
  scss: { icon: Palette, color: 'text-pink-500' },
  sass: { icon: Palette, color: 'text-pink-500' },
  less: { icon: Palette, color: 'text-blue-400' },

  // JavaScript/TypeScript
  js: { icon: FileCode2, color: 'text-yellow-500' },
  jsx: { icon: FileCode2, color: 'text-yellow-500' },
  ts: { icon: FileCode2, color: 'text-blue-600' },
  tsx: { icon: FileCode2, color: 'text-blue-600' },
  mjs: { icon: FileCode2, color: 'text-yellow-500' },
  cjs: { icon: FileCode2, color: 'text-yellow-500' },

  // JSON/Data
  json: { icon: FileJson, color: 'text-yellow-600' },
  jsonc: { icon: FileJson, color: 'text-yellow-600' },
  json5: { icon: FileJson, color: 'text-yellow-600' },
  yaml: { icon: FileText, color: 'text-purple-500' },
  yml: { icon: FileText, color: 'text-purple-500' },
  toml: { icon: FileText, color: 'text-purple-500' },
  xml: { icon: FileCode, color: 'text-orange-600' },

  // Images
  png: { icon: Image, color: 'text-green-500' },
  jpg: { icon: Image, color: 'text-green-500' },
  jpeg: { icon: Image, color: 'text-green-500' },
  gif: { icon: Image, color: 'text-green-500' },
  svg: { icon: Image, color: 'text-green-600' },
  webp: { icon: Image, color: 'text-green-500' },
  ico: { icon: Image, color: 'text-green-500' },
  bmp: { icon: Image, color: 'text-green-500' },

  // Video
  mp4: { icon: Video, color: 'text-purple-600' },
  webm: { icon: Video, color: 'text-purple-600' },
  ogg: { icon: Video, color: 'text-purple-600' },
  mov: { icon: Video, color: 'text-purple-600' },
  avi: { icon: Video, color: 'text-purple-600' },

  // Audio
  mp3: { icon: Music, color: 'text-pink-600' },
  wav: { icon: Music, color: 'text-pink-600' },
  flac: { icon: Music, color: 'text-pink-600' },
  aac: { icon: Music, color: 'text-pink-600' },

  // Documents
  md: { icon: FileText, color: 'text-gray-600 dark:text-gray-400' },
  txt: { icon: FileText, color: 'text-gray-600 dark:text-gray-400' },
  pdf: { icon: FileText, color: 'text-red-600' },
  doc: { icon: FileText, color: 'text-blue-700' },
  docx: { icon: FileText, color: 'text-blue-700' },

  // Archives
  zip: { icon: FileArchive, color: 'text-yellow-700' },
  tar: { icon: FileArchive, color: 'text-yellow-700' },
  gz: { icon: FileArchive, color: 'text-yellow-700' },
  rar: { icon: FileArchive, color: 'text-yellow-700' },
  '7z': { icon: FileArchive, color: 'text-yellow-700' },

  // Database
  db: { icon: Database, color: 'text-indigo-600' },
  sql: { icon: Database, color: 'text-indigo-600' },
  sqlite: { icon: Database, color: 'text-indigo-600' },

  // Fonts
  ttf: { icon: FileType, color: 'text-gray-700' },
  otf: { icon: FileType, color: 'text-gray-700' },
  woff: { icon: FileType, color: 'text-gray-700' },
  woff2: { icon: FileType, color: 'text-gray-700' },
  eot: { icon: FileType, color: 'text-gray-700' },

  // Other code files
  py: { icon: FileCode, color: 'text-blue-500' },
  rb: { icon: FileCode, color: 'text-red-500' },
  php: { icon: FileCode, color: 'text-purple-500' },
  java: { icon: FileCode, color: 'text-red-600' },
  c: { icon: FileCode, color: 'text-blue-700' },
  cpp: { icon: FileCode, color: 'text-blue-700' },
  h: { icon: FileCode, color: 'text-blue-700' },
  cs: { icon: FileCode, color: 'text-green-700' },
  go: { icon: FileCode, color: 'text-cyan-600' },
  rs: { icon: FileCode, color: 'text-orange-700' },
  swift: { icon: FileCode, color: 'text-orange-600' },
  kt: { icon: FileCode, color: 'text-purple-600' },
  sh: { icon: FileCode, color: 'text-gray-700' },
  bash: { icon: FileCode, color: 'text-gray-700' },
  zsh: { icon: FileCode, color: 'text-gray-700' },

  // Config files
  env: { icon: FileText, color: 'text-yellow-700' },
  config: { icon: FileText, color: 'text-gray-600' },
  conf: { icon: FileText, color: 'text-gray-600' },
  lock: { icon: FileText, color: 'text-gray-500' },
  gitignore: { icon: FileText, color: 'text-gray-500' },
  dockerignore: { icon: FileText, color: 'text-gray-500' },
};

/**
 * Get file extension from filename
 */
function getExtension(fileName: string): string {
  // Handle special cases (dotfiles without extension)
  if (fileName === '.gitignore' || fileName === '.dockerignore') {
    return fileName.substring(1);
  }

  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';

  return fileName.substring(lastDot + 1).toLowerCase();
}

/**
 * Get icon config for a file based on its extension
 */
function getFileIconConfig(fileName: string): IconConfig {
  const extension = getExtension(fileName);

  return (
    EXTENSION_ICON_MAP[extension] || {
      icon: File,
      color: 'text-gray-500 dark:text-gray-400',
    }
  );
}

/**
 * FileIcon component - displays appropriate icon for files and folders
 */
export function FileIcon({
  fileName,
  isDirectory = false,
  isOpen = false,
  size = 16,
  className = '',
}: FileIconProps) {
  if (isDirectory) {
    const Icon = isOpen ? FolderOpen : Folder;
    return (
      <Icon
        size={size}
        className={`text-blue-500 dark:text-blue-400 ${className}`}
      />
    );
  }

  const { icon: Icon, color } = getFileIconConfig(fileName);

  return <Icon size={size} className={`${color} ${className}`} />;
}

/**
 * Get icon component and color for use outside of React (e.g., for utilities)
 */
export function getFileIcon(fileName: string, isDirectory: boolean = false): IconConfig {
  if (isDirectory) {
    return {
      icon: Folder,
      color: 'text-blue-500 dark:text-blue-400',
    };
  }

  return getFileIconConfig(fileName);
}