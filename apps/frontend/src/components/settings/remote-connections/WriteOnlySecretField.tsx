// A field for a secret the API never returns: it only ever says whether one is
// stored. So there is no value to edit — only "replace it", "remove it", or
// "leave it alone" (lifted from the ffmpeg executor panel's key editor).
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EnvBadge } from './shared';

export interface WriteOnlySecretFieldProps {
  id: string;
  label: string;
  /** Is a secret stored server-side? */
  stored: boolean;
  /** The env var that pins it, when the environment provides it (read-only then). */
  envManagedBy?: string | null;
  /** Textarea contents; '' = nothing to send. */
  value: string;
  /** "Remove" clicked → the caller should send null on save. */
  remove: boolean;
  onChange: (patch: { value?: string; remove?: boolean }) => void;
  placeholder?: string;
  help?: string;
  rows?: number;
}

export function WriteOnlySecretField({
  id,
  label,
  stored,
  envManagedBy,
  value,
  remove,
  onChange,
  placeholder,
  help,
  rows = 4,
}: WriteOnlySecretFieldProps) {
  const [replacing, setReplacing] = useState(false);
  const showEditor = !stored || replacing;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {envManagedBy && <EnvBadge name={envManagedBy} />}
        {stored && !envManagedBy && (
          <Badge variant="outline" className="text-[10px]">
            Key stored
          </Badge>
        )}
      </div>
      {envManagedBy ? (
        <p className="text-xs text-muted-foreground">
          Provided by the environment; not editable here.
        </p>
      ) : showEditor ? (
        <>
          <Textarea
            id={id}
            rows={rows}
            placeholder={placeholder}
            className="font-mono text-xs"
            value={value}
            onChange={(e) => onChange({ value: e.target.value, remove: false })}
          />
          {help && <p className="text-xs text-muted-foreground">{help}</p>}
          {replacing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setReplacing(false);
                onChange({ value: '' });
              }}
            >
              Cancel
            </Button>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReplacing(true);
              onChange({ remove: false });
            }}
          >
            Replace key
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ remove: !remove, value: '' })}
          >
            {remove ? 'Keep key' : 'Remove key'}
          </Button>
          {remove && (
            <span className="text-xs text-destructive">
              Key will be removed on save (ADC will be used).
            </span>
          )}
        </div>
      )}
    </div>
  );
}
