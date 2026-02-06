import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { buildPublicUrl } from '@/lib/utils';

interface MarkdownViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
}

export function MarkdownViewer({ owner, repo, gitRef, filepath }: MarkdownViewerProps) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = import.meta.env.VITE_API_URL || '';
  const fileUrl = buildPublicUrl(apiBaseUrl, owner, repo, gitRef, filepath);

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
    <div className="flex-1 min-h-0 overflow-auto bg-background">
      <div className="p-6 max-w-4xl mx-auto">
        <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:border">
          <ReactMarkdown>{content}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
