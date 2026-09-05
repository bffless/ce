import { useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGetRuleSetRulesQuery } from '@/services/proxyRulesApi';
import { cn } from '@/lib/utils';
import { findSibling, type SiblingRule } from './model';

interface SiblingRulePickerProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
  /** The method the MCP step will invoke the sibling with (GET for resources). */
  method?: string;
  /** The rule set whose rules answer the path; without it the field is plain text. */
  ruleSetId?: string;
  /** The rule being edited — it cannot answer its own tools. */
  excludeRuleId?: string;
  /** For templates: `{var}` segments are matched as wildcards. */
  template?: boolean;
  placeholder?: string;
  help?: string;
}

const methodsOf = (r: SiblingRule): string[] =>
  r.methods && r.methods.length ? r.methods : r.method ? [r.method] : ['ANY'];

/**
 * A sibling rule's path: a combobox over the rule set's rules (free text
 * allowed) with a hint saying which enabled rule would answer it — as the
 * edge resolves it, so a miss is a hint, not an error: another set attached
 * to the same alias may answer.
 */
export function SiblingRulePicker({
  label,
  value,
  onChange,
  method = 'GET',
  ruleSetId,
  excludeRuleId,
  template = false,
  placeholder = '/api/...',
  help,
}: SiblingRulePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data } = useGetRuleSetRulesQuery(ruleSetId ?? '', { skip: !ruleSetId });

  const rules = useMemo<SiblingRule[]>(
    () => (data?.rules ?? []).filter((r) => r.id !== excludeRuleId),
    [data, excludeRuleId],
  );

  const sibling = useMemo(() => {
    if (!ruleSetId || !value) return undefined;
    const probe = template ? value.replace(/\{[^}]+\}/g, 'x') : value;
    return findSibling(rules, probe, method);
  }, [ruleSetId, value, template, rules, method]);

  if (!ruleSetId) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm"
        />
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal font-mono text-sm"
          >
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search rules or type a path..."
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                onChange(v);
              }}
            />
            <CommandList>
              <CommandEmpty>
                <div className="py-2 text-sm text-muted-foreground">
                  Using <span className="font-mono">{value || '…'}</span>
                </div>
              </CommandEmpty>
              <CommandGroup heading="Rules in this set">
                {rules.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.pathPattern}
                    className={cn(!r.isEnabled && 'opacity-60')}
                    onSelect={() => {
                      onChange(r.pathPattern);
                      setSearch('');
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === r.pathPattern ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="font-mono text-sm flex-1 truncate">{r.pathPattern}</span>
                    <span className="flex gap-1">
                      {methodsOf(r).map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px] px-1 py-0">
                          {m}
                        </Badge>
                      ))}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value &&
        (sibling ? (
          <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              Answered by <span className="font-mono">{sibling.pathPattern}</span>
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              No enabled rule in this set answers {method} {value}. Another set on the same alias
              may — otherwise the tool fails with &quot;no rule answers&quot;.
            </span>
          </p>
        ))}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
