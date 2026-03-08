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

// Default HTML template for new email handlers
const DEFAULT_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
    .field { margin-bottom: 15px; }
    .label { font-weight: 600; color: #555; }
    .value { margin-top: 5px; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>New Form Submission</h2>
    </div>

    <div class="field">
      <div class="label">Name</div>
      <div class="value">{{input.name}}</div>
    </div>

    <div class="field">
      <div class="label">Email</div>
      <div class="value">{{input.email}}</div>
    </div>

    <div class="field">
      <div class="label">Message</div>
      <div class="value">{{input.message}}</div>
    </div>

    <div class="footer">
      Submitted on {{metadata.path}} via {{metadata.method}}
    </div>
  </div>
</body>
</html>`;

interface EmailHandlerConfigProps {
  config: Partial<EmailHandlerConfig>;
  onChange: (config: EmailHandlerConfig) => void;
}

export function EmailHandlerConfig({ config, onChange }: EmailHandlerConfigProps) {
  const [to, setTo] = useState(config.to || '');
  const [subject, setSubject] = useState(config.subject || '');
  const [body, setBody] = useState(config.body || DEFAULT_EMAIL_TEMPLATE);
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
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <Editor
              height="300px"
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
