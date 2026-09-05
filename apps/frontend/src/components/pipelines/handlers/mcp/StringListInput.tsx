import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface StringListSuggestion {
  value: string;
  hint?: string;
}

interface StringListInputProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Quick-add chips shown under the input (hidden once present in the list). */
  suggestions?: StringListSuggestion[];
  help?: string;
}

/** A list of strings edited as chips: type + Enter (or comma) to add, × to remove. */
export function StringListInput({
  label,
  value,
  onChange,
  placeholder,
  suggestions = [],
  help,
}: StringListInputProps) {
  const id = useId();
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
  };

  const commitDraft = () => {
    add(draft);
    setDraft('');
  };

  const pending = suggestions.filter((s) => !value.includes(s.value));

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="font-mono font-normal gap-1 pr-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="rounded-sm hover:bg-muted-foreground/20"
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && commitDraft()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitDraft();
          }
        }}
        className="font-mono text-sm"
      />
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((s) => (
            <Button
              key={s.value}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs font-normal"
              aria-label={`Add ${s.value}`}
              title={s.hint}
              onClick={() => add(s.value)}
            >
              + <span className="font-mono ml-1">{s.value}</span>
              {s.hint && <span className="ml-1 text-muted-foreground">{s.hint}</span>}
            </Button>
          ))}
        </div>
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
