import { useEffect, useId, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isRecord } from './model';

interface JsonFieldProps {
  label: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  help?: string;
  minHeightClass?: string;
}

/**
 * A JSON object edited as text. Applied when the field loses focus; a body
 * that does not parse (or is not an object) is reported and never applied.
 */
export function JsonField({
  label,
  value,
  onChange,
  help,
  minHeightClass = 'min-h-[200px]',
}: JsonFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  // A value replaced from outside (another tab's edit, a reload) re-seeds the text.
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setError(null);
  }, [value]);

  const commit = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error('the value must be a JSON object');
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        spellCheck={false}
        className={`font-mono text-xs ${minHeightClass}`}
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          Not saved — {error}
        </p>
      ) : (
        help && <p className="text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
