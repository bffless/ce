import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Copy,
  Download,
  WrapText,
  Check,
  ExternalLink,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useTheme } from '@/components/common/ThemeProvider';
import { highlightCode } from '@/lib/syntax-highlighter';
import { buildPublicUrl } from '@/lib/utils';

interface CodeViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  /** MIME type to help determine the language */
  mimeType?: string;
}

/**
 * Maps file extensions to Shiki language identifiers
 */
function getLanguageFromFilepath(filepath: string): string {
  const extension = filepath.split('.').pop()?.toLowerCase() || '';

  // Common language mappings
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Data formats
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    toml: 'toml',

    // Markdown & docs
    md: 'markdown',
    mdx: 'mdx',
    rst: 'rst',

    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'fish',

    // Python
    py: 'python',
    pyw: 'python',

    // Ruby
    rb: 'ruby',
    rake: 'ruby',

    // Go
    go: 'go',

    // Rust
    rs: 'rust',

    // C/C++
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',

    // C#
    cs: 'csharp',

    // Java
    java: 'java',

    // PHP
    php: 'php',

    // Swift
    swift: 'swift',

    // Kotlin
    kt: 'kotlin',

    // SQL
    sql: 'sql',

    // Docker
    dockerfile: 'dockerfile',

    // Config files
    env: 'dotenv',
    gitignore: 'gitignore',
    ini: 'ini',
    conf: 'nginx',

    // Others
    graphql: 'graphql',
    proto: 'protobuf',
    txt: 'text',
  };

  return languageMap[extension] || 'text';
}

export function CodeViewer({ owner, repo, gitRef, filepath, mimeType }: CodeViewerProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rawCode, setRawCode] = useState<string>('');
  const { resolvedTheme } = useTheme();

  const language = getLanguageFromFilepath(filepath);

  // Build the public URL for the file
  // In development, use relative path (proxied by Vite to localhost:3000)
  // In production, VITE_API_URL can be set or use relative path
  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const fileUrl = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);

  // Fetch and highlight code
  useEffect(() => {
    let isMounted = true;

    const fetchAndHighlight = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch file content from public endpoint
        const response = await fetch(fileUrl, {
          credentials: 'include', // Include cookies for authentication
        });

        if (!isMounted) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        // Convert response to text
        const text = await response.text();
        setRawCode(text);

        // Highlight code with Shiki (theme matches app theme, lazy-loaded)
        const html = await highlightCode(
          text,
          language,
          resolvedTheme === 'dark' ? 'github-dark' : 'github-light',
        );

        if (!isMounted) return;

        setHighlightedCode(html);
        setIsLoading(false);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setIsLoading(false);
      }
    };

    fetchAndHighlight();

    return () => {
      isMounted = false;
    };
  }, [fileUrl, language, resolvedTheme]);

  // Copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Download file
  const handleDownload = () => {
    const blob = new Blob([rawCode], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filepath.split('/').pop() || 'download.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open in new tab
  const handleOpenInNewTab = () => {
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  // Retry loading
  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    // Trigger re-fetch by changing the component state (useEffect will re-run)
  };

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex-1 p-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-4 w-[95%]" />
          <Skeleton className="h-4 w-[85%]" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[92%]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <div className="flex-1 text-xs text-muted-foreground">Error loading file</div>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-3">
              <div>
                <p className="font-medium">Failed to load file</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
              <Button onClick={handleRetry} size="sm" variant="outline" className="w-fit">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <div className="flex-1 text-xs text-muted-foreground">
          Language: <span className="font-medium">{language}</span>
          {' • '}
          Lines: <span className="font-medium">{rawCode.split('\n').length}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWrapLines(!wrapLines)}
            title={wrapLines ? 'Disable line wrapping' : 'Enable line wrapping'}
            className="h-7 px-2"
          >
            <WrapText className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            title="Copy code"
            className="h-7 px-2"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            title="Download file"
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

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        <div
          className={`shiki-container ${wrapLines ? 'wrap-lines' : ''}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </div>

      <style>{`
        .shiki-container {
          font-family: 'Courier New', Courier, monospace;
          font-size: 14px;
          line-height: 1.5;
          min-height: 100%;
        }
        .shiki-container pre {
          margin: 0;
          padding: 1rem;
          min-width: 100%;
          width: max-content;
        }
        .shiki-container.wrap-lines pre {
          white-space: pre-wrap;
          word-break: break-word;
          width: 100%;
        }
        .shiki-container code {
          counter-reset: line;
          display: block;
        }
        .shiki-container .line {
          counter-increment: line;
          padding-left: 0.5rem;
        }
        .shiki-container .line::before {
          content: counter(line);
          display: inline-block;
          width: 3rem;
          margin-right: 1rem;
          text-align: right;
          color: #6b7280;
          user-select: none;
        }
      `}</style>
    </div>
  );
}
