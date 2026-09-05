import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { JsonField } from './JsonField';
import { StringListInput } from './StringListInput';
import {
  PROP_TYPES,
  emptyRow,
  isFlatObjectSchema,
  rowsToSchema,
  schemaToRows,
  type FlatSchema,
  type PropType,
  type PropertyRow,
} from './input-schema';

interface InputSchemaEditorProps {
  value: Record<string, unknown>;
  onChange: (schema: Record<string, unknown>) => void;
}

/**
 * A tool's `inputSchema` as a property table — one row per argument — with a
 * JSON view for anything the table can't show.
 */
export function InputSchemaEditor({ value, onChange }: InputSchemaEditorProps) {
  const flatAble = isFlatObjectSchema(value);
  const [jsonMode, setJsonMode] = useState(!flatAble);
  const [flat, setFlat] = useState<FlatSchema>(() =>
    flatAble ? schemaToRows(value) : { rows: [], additionalProperties: false },
  );
  // What we last emitted; an incoming value equal to it is our own echo, and
  // must not rebuild the rows (that would drop a half-typed row).
  const lastEmitted = useRef<string>(JSON.stringify(value));

  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    const ok = isFlatObjectSchema(value);
    if (ok) setFlat(schemaToRows(value));
    setJsonMode(!ok);
  }, [value]);

  const emit = (next: FlatSchema) => {
    setFlat(next);
    const schema = rowsToSchema(next);
    lastEmitted.current = JSON.stringify(schema);
    onChange(schema);
  };

  const updateRow = (i: number, patch: Partial<PropertyRow>) =>
    emit({ ...flat, rows: flat.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  if (jsonMode) {
    return (
      <div className="space-y-2">
        <JsonField
          label="Input schema (JSON)"
          value={value}
          onChange={(v) => {
            lastEmitted.current = JSON.stringify(v);
            onChange(v);
            if (isFlatObjectSchema(v)) setFlat(schemaToRows(v));
          }}
          help="A JSON Schema object describing the tool's arguments."
        />
        {flatAble ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setJsonMode(false)}>
            Edit as table
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            This schema uses features the table builder can&apos;t show (nested objects,{' '}
            <code>oneOf</code>, <code>$ref</code>, patterns…), so it is edited as JSON.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Arguments</Label>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setJsonMode(true)}>
            Edit as JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => emit({ ...flat, rows: [...flat.rows, emptyRow()] })}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add property
          </Button>
        </div>
      </div>

      {flat.rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No arguments — the tool is called with {'{}'}.
        </p>
      )}

      {flat.rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <Input
            value={row.name}
            placeholder="name"
            aria-label={`Property ${i + 1} name`}
            onChange={(e) => updateRow(i, { name: e.target.value })}
            className="w-full font-mono text-sm sm:w-40"
          />
          <Select value={row.type} onValueChange={(t) => updateRow(i, { type: t as PropType })}>
            <SelectTrigger className="w-full sm:w-28" aria-label={`${row.name || 'property'} type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={row.description ?? ''}
            placeholder="description"
            aria-label={`${row.name || 'property'} description`}
            onChange={(e) => updateRow(i, { description: e.target.value || undefined })}
            className="min-w-0 flex-1 text-sm"
          />
          <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <Checkbox
              checked={row.required}
              aria-label={`${row.name || 'property'} required`}
              onCheckedChange={(c) => updateRow(i, { required: c === true })}
            />
            required
          </label>
          <RowExtras row={row} onChange={(patch) => updateRow(i, patch)} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Remove ${row.name || 'property'}`}
            onClick={() => emit({ ...flat, rows: flat.rows.filter((_, j) => j !== i) })}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ))}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={flat.additionalProperties}
          aria-label="Allow extra arguments"
          onCheckedChange={(c) => emit({ ...flat, additionalProperties: c })}
        />
        Allow extra arguments not listed above
      </label>
    </div>
  );
}

const numberOrUndefined = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** Per-type constraints behind a gear: enum, min/max, item type, open object. */
function RowExtras({
  row,
  onChange,
}: {
  row: PropertyRow;
  onChange: (patch: Partial<PropertyRow>) => void;
}) {
  const numeric = row.type === 'integer' || row.type === 'number';
  const hasExtras =
    (row.enum && row.enum.length > 0) ||
    row.minimum !== undefined ||
    row.maximum !== undefined ||
    row.items !== undefined ||
    row.additionalProperties !== undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={hasExtras ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          aria-label={`${row.name || 'property'} constraints`}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        {row.type === 'string' && (
          <StringListInput
            label="Allowed values (enum)"
            value={row.enum ?? []}
            onChange={(v) => onChange({ enum: v.length ? v : undefined })}
            placeholder="value, Enter"
          />
        )}
        {numeric && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Minimum</Label>
              <Input
                type="number"
                value={row.minimum ?? ''}
                onChange={(e) => onChange({ minimum: numberOrUndefined(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Maximum</Label>
              <Input
                type="number"
                value={row.maximum ?? ''}
                onChange={(e) => onChange({ maximum: numberOrUndefined(e.target.value) })}
              />
            </div>
          </div>
        )}
        {row.type === 'object' && (
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={row.additionalProperties !== false}
              onCheckedChange={(c) => onChange({ additionalProperties: c ? true : false })}
            />
            Any keys allowed (open object)
          </label>
        )}
        {row.type === 'array' && (
          <div className="space-y-1">
            <Label className="text-xs">Item type</Label>
            <Select
              value={row.items?.type ?? 'string'}
              onValueChange={(t) => onChange({ items: { ...row.items, type: t as PropType } })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROP_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {(row.type === 'boolean' ||
          (!numeric && row.type !== 'string' && row.type !== 'object' && row.type !== 'array')) && (
          <p className="text-xs text-muted-foreground">No constraints for this type.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
