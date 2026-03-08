import { useState, useEffect, lazy, Suspense } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { EmailHandlerConfig } from './types';

// Lazy load Monaco Editor to reduce initial bundle size
const Editor = lazy(() => import('@monaco-editor/react'));

interface EmailHandlerConfigProps {
  config: Partial<EmailHandlerConfig>;
  onChange: (config: EmailHandlerConfig) => void;
}

export function EmailHandlerConfig({ config, onChange }: EmailHandlerConfigProps) {
  const [to, setTo] = useState(config.to || '');
  const [subject, setSubject] = useState(config.subject || '');
  const [body, setBody] = useState(config.body || '');
  const [replyTo, setReplyTo] = useState(config.replyTo || '');

  useEffect(() => {
    onChange({
      to,
      subject,
      body,
      replyTo: replyTo.trim() || undefined,
    });
  }, [to, subject, body, replyTo, onChange]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="to">Recipient (To)</Label>
            <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Use an expression like <code>input.email</code> or <code>user.email</code></p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Input
          id="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="input.email"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="subject">Subject</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Use template syntax: <code>{'{{input.name}}'}</code> for dynamic values</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="New submission from {{input.name}}"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="body">Body (HTML)</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>HTML email body with template syntax.</p>
              <p className="mt-1">Example:</p>
              <code className="text-xs">{'<p>Hello {{input.name}},</p>'}</code>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="border rounded-md overflow-hidden">
          <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
            <Editor
              height="200px"
              defaultLanguage="html"
              value={body}
              onChange={(value) => setBody(value || '')}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 13,
                tabSize: 2,
                padding: { top: 8, bottom: 8 },
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'hidden',
                },
              }}
              theme="vs-dark"
            />
          </Suspense>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="replyTo">Reply-To (optional)</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Expression for reply-to address, e.g., <code>input.email</code></p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Input
          id="replyTo"
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          placeholder="input.email (optional)"
        />
      </div>
    </div>
    </TooltipProvider>
  );
}
