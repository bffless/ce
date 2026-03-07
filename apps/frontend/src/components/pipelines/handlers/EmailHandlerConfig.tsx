import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { EmailHandlerConfig } from './types';

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
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="to">Recipient (To)</Label>
          <Tooltip>
            <TooltipTrigger>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
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
            <TooltipTrigger>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
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
            <TooltipTrigger>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>HTML email body with template syntax.</p>
              <p className="mt-1">Example:</p>
              <code className="text-xs">{'<p>Hello {{input.name}},</p>'}</code>
            </TooltipContent>
          </Tooltip>
        </div>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>Hello {{input.name}},</p>
<p>Thank you for your submission.</p>"
          rows={6}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="replyTo">Reply-To (optional)</Label>
          <Tooltip>
            <TooltipTrigger>
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
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
  );
}
