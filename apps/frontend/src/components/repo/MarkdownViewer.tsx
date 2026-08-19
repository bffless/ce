import { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, AlertCircle, Code, Eye, Copy, Check, ExternalLink } from 'lucide-react';
import { buildPublicUrl } from '@/lib/utils';

interface MarkdownViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  /** Optional left-side actions to render in toolbar (e.g., hamburger menu) */
  leftActions?: ReactNode;
}

/**
 * Splits leading YAML frontmatter (--- ... ---) from the markdown body.
 * Returns the parsed key/value pairs (best-effort, line-based) and the body.
 * GitHub renders frontmatter as a table rather than as raw text, so we do the same.
 */
function splitFrontmatter(raw: string): {
  frontmatter: Array<{ key: string; value: string }> | null;
  body: string;
} {
  const match = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: raw };

  const block = match[1];
  const body = raw.slice(match[0].length);

  const entries: Array<{ key: string; value: string }> = [];
  for (const line of block.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s?(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      // Strip matching surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      entries.push({ key: kv[1], value });
    } else if (entries.length > 0 && line.trim()) {
      // Continuation of a wrapped value
      entries[entries.length - 1].value += ` ${line.trim()}`;
    }
  }

  return { frontmatter: entries.length > 0 ? entries : null, body };
}

export function MarkdownViewer({
  owner,
  repo,
  gitRef,
  filepath,
  leftActions,
}: MarkdownViewerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const fileUrl = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);

  const { frontmatter, body } = useMemo(() => splitFrontmatter(content), [content]);

  const handleSwitchToCode = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', 'code');
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  const handleOpenInNewTab = useCallback(() => {
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }, [fileUrl]);

  useEffect(() => {
    let isMounted = true;

    const fetchContent = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(fileUrl, {
          credentials: 'include',
        });

        if (!isMounted) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const text = await response.text();
        if (!isMounted) return;

        setContent(text);
        setIsLoading(false);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setIsLoading(false);
      }
    };

    fetchContent();

    return () => {
      isMounted = false;
    };
  }, [fileUrl]);

  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    // Re-trigger useEffect by updating state
    setContent('');
  };

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background p-6">
        <div className="space-y-4 max-w-4xl">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-4 w-[95%]" />
          <Skeleton className="h-4 w-[85%]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-3">
              <div>
                <p className="font-medium">Failed to load markdown</p>
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
      <TooltipProvider>
        <div className="flex items-center gap-2 px-2 py-2 border-b bg-muted/30">
          {/* Left actions (hamburger menu when sidebar collapsed) */}
          {leftActions}

          <div className="flex-1 text-xs text-muted-foreground">Markdown Preview</div>

          <div className="flex items-center gap-1">
            {/* View Mode Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSwitchToCode}
                  className="h-7 w-7 p-0"
                >
                  <Code className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View source (Alt+C)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 bg-accent" disabled>
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview (Alt+P)</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 w-7 p-0">
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied!' : 'Copy markdown'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  className="h-7 w-7 p-0"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-4xl mx-auto">
          {/* Frontmatter rendered as a GitHub-style table */}
          {frontmatter && (
            <table className="markdown-frontmatter mb-6 w-full border-collapse text-sm">
              <tbody>
                {frontmatter.map(({ key, value }) => (
                  <tr key={key}>
                    <th className="border border-border bg-muted/50 px-3 py-2 text-left align-top font-semibold whitespace-nowrap">
                      {key}
                    </th>
                    <td className="border border-border px-3 py-2 text-left align-top">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <article
            className="markdown-body prose prose-sm dark:prose-invert max-w-none
              prose-headings:font-semibold prose-headings:scroll-mt-4
              prose-h1:pb-2 prose-h1:border-b prose-h1:border-border
              prose-h2:pb-2 prose-h2:border-b prose-h2:border-border prose-h2:mt-8
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-muted prose-pre:border prose-pre:text-foreground
              prose-img:rounded prose-hr:border-border
              prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-blockquote:font-normal prose-blockquote:not-italic"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </article>
        </div>
      </div>

      {/* GitHub-style table + task list rendering for the markdown body */}
      <style>{`
        .markdown-body table {
          display: block;
          width: max-content;
          max-width: 100%;
          overflow: auto;
          border-collapse: collapse;
        }
        .markdown-body th,
        .markdown-body td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem 0.75rem;
        }
        .markdown-body thead th {
          background: hsl(var(--muted) / 0.5);
        }
        .markdown-body tbody tr:nth-child(2n) {
          background: hsl(var(--muted) / 0.3);
        }
        .markdown-body ul.contains-task-list {
          list-style: none;
          padding-left: 0;
        }
        .markdown-body li.task-list-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .markdown-body li.task-list-item input[type='checkbox'] {
          margin-top: 0.3rem;
        }
      `}</style>
    </div>
  );
}
