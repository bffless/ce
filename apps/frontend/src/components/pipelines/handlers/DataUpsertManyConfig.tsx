import { useState, useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { DataUpsertManyHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Partial<DataUpsertManyHandlerConfig>;
  onChange: (config: DataUpsertManyHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FieldMapping {
  schemaField: string;
  expression: string;
}

/** Normalize the stored dedupKey (string | string[]) into an editable list of rows. */
function initialDedupKeys(dedupKey: string | string[] | undefined): string[] {
  if (Array.isArray(dedupKey)) {
    return dedupKey.length > 0 ? dedupKey : [''];
  }
  if (typeof dedupKey === 'string' && dedupKey.trim()) {
    return [dedupKey];
  }
  return [''];
}

export function DataUpsertManyConfig({ config, onChange, projectId, previousSteps = [] }: Props) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [items, setItems] = useState(config.items || '');
  const [dedupField, setDedupField] = useState(config.dedupField || '');
  const [dedupKeys, setDedupKeys] = useState<string[]>(() => initialDedupKeys(config.dedupKey));
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(() => {
    const entries = Object.entries(config.map || {});
    return entries.length > 0
      ? entries.map(([schemaField, expression]) => ({ schemaField, expression }))
      : [{ schemaField: '', expression: '' }];
  });

  const usedFields = useMemo(
    () => fieldMappings.map((m) => m.schemaField).filter(Boolean),
    [fieldMappings],
  );

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      if (mapping.schemaField.trim()) {
        map[mapping.schemaField.trim()] = mapping.expression;
      }
    }
    const keys = dedupKeys.map((k) => k.trim()).filter(Boolean);
    onChange({
      schemaId,
      items,
      dedupField,
      // Store a single string when there's one key, else the fallback chain.
      dedupKey: keys.length === 1 ? keys[0] : keys,
      map,
    });
  }, [schemaId, items, dedupField, dedupKeys, fieldMappings, onChange]);

  const handleSchemaChange = (newSchemaId: string) => {
    setSchemaId(newSchemaId);
    setDedupField('');
    setFieldMappings([{ schemaField: '', expression: '' }]);
  };

  const handleMappingChange = (index: number, updates: Partial<FieldMapping>) => {
    setFieldMappings(fieldMappings.map((m, i) => (i === index ? { ...m, ...updates } : m)));
  };

  const setDedupKeyAt = (index: number, value: string) => {
    setDedupKeys(dedupKeys.map((k, i) => (i === index ? value : k)));
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Target Schema</Label>
          <SchemaPicker projectId={projectId} value={schemaId} onChange={handleSchemaChange} />
        </div>

        <div className="space-y-2">
          <Label>Items (source array)</Label>
          <ExpressionInput
            value={items}
            onChange={setItems}
            placeholder="steps.parse.entries"
            previousSteps={previousSteps}
          />
          <p className="text-xs text-muted-foreground">
            An expression resolving to an array. Each element is inserted as a record and is exposed
            to the mappings below as <code>steps.item</code>.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Dedup Field</Label>
          <SchemaFieldPicker
            schemaId={schemaId}
            value={dedupField}
            onChange={setDedupField}
            placeholder="Select the column that stores the dedup key"
          />
          <p className="text-xs text-muted-foreground">
            The schema column whose value uniquely identifies a record. Existing rows with a
            matching value are skipped (insert-only — never overwritten).
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label>Dedup Key</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="cursor-help">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    How to compute each item's dedup value. Add multiple rows for a fallback chain —
                    the first that resolves to a non-empty value wins (e.g.{' '}
                    <code>steps.item.guid</code> then <code>steps.item.link</code>). If none
                    resolve, a content hash is used.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDedupKeys([...dedupKeys, ''])}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add fallback
            </Button>
          </div>
          <div className="space-y-2">
            {dedupKeys.map((key, index) => (
              <div key={index} className="flex items-center gap-2">
                <ExpressionInput
                  value={key}
                  onChange={(value) => setDedupKeyAt(index, value)}
                  placeholder="steps.item.guid"
                  previousSteps={previousSteps}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDedupKeys(dedupKeys.filter((_, i) => i !== index))}
                  disabled={dedupKeys.length === 1}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label>Field Mappings</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="cursor-help">
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Map schema columns to expressions, evaluated per array element. Paths:</p>
                  <ul className="list-disc list-inside mt-1 text-xs">
                    <li>
                      <code>steps.item.field</code> - Current array element
                    </li>
                    <li>
                      <code>steps.stepName.field</code> - Another step's output
                    </li>
                    <li>
                      <code>now()</code> - Current timestamp
                    </li>
                    <li>
                      <code>request.body.field</code> - Request body
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setFieldMappings([...fieldMappings, { schemaField: '', expression: '' }])
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Field
            </Button>
          </div>

          <div className="space-y-2">
            {fieldMappings.map((mapping, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <SchemaFieldPicker
                    schemaId={schemaId}
                    value={mapping.schemaField}
                    onChange={(value) => handleMappingChange(index, { schemaField: value })}
                    usedFields={usedFields}
                    placeholder="Select field"
                  />
                </div>
                <span className="text-muted-foreground">=</span>
                <div className="flex-1">
                  <ExpressionInput
                    value={mapping.expression}
                    onChange={(value) => handleMappingChange(index, { expression: value })}
                    placeholder="steps.item.fieldName"
                    previousSteps={previousSteps}
                    className="flex-1"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    fieldMappings.length > 1 &&
                    setFieldMappings(fieldMappings.filter((_, i) => i !== index))
                  }
                  disabled={fieldMappings.length === 1}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
