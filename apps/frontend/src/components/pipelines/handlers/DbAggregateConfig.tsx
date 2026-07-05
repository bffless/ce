import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Plus, Trash2 } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type { DbAggregateHandlerConfig, FilterConfig } from './types';
import { serializeFilterValue, displayFilterValue } from './filter-value';

interface DbAggregateConfigProps {
  config: Partial<DbAggregateHandlerConfig>;
  onChange: (config: DbAggregateHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FilterEntry {
  field: string;
  op: FilterConfig['op'];
  value: string;
}

const OPERATIONS: {
  value: DbAggregateHandlerConfig['operation'];
  label: string;
  requiresField: boolean;
}[] = [
  { value: 'count', label: 'Count', requiresField: false },
  { value: 'sum', label: 'Sum', requiresField: true },
  { value: 'avg', label: 'Average', requiresField: true },
  { value: 'min', label: 'Minimum', requiresField: true },
  { value: 'max', label: 'Maximum', requiresField: true },
  { value: 'array_length', label: 'Array Length (sum)', requiresField: true },
];

const FILTER_OPS: { value: FilterConfig['op']; label: string }[] = [
  { value: 'eq', label: 'Equals (=)' },
  { value: 'ne', label: 'Not Equals (!=)' },
  { value: 'gt', label: 'Greater Than (>)' },
  { value: 'gte', label: 'Greater or Equal (>=)' },
  { value: 'lt', label: 'Less Than (<)' },
  { value: 'lte', label: 'Less or Equal (<=)' },
  { value: 'like', label: 'Like (pattern)' },
  { value: 'in', label: 'In (any of)' },
];

export function DbAggregateConfig({ config, onChange, projectId, previousSteps = [] }: DbAggregateConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [operation, setOperation] = useState<DbAggregateHandlerConfig['operation']>(
    config.operation || 'count',
  );
  const [field, setField] = useState(config.field || '');
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([f, conf]) => ({ field: f, op: conf.op, value: displayFilterValue(conf.value) }))
      : [];
  });
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>(config.filterLogic || 'and');
  const [groupBy, setGroupBy] = useState(config.groupBy || '');

  const selectedOp = OPERATIONS.find((op) => op.value === operation);
  const requiresField = selectedOp?.requiresField ?? false;

  useEffect(() => {
    const filtersRecord: Record<string, FilterConfig> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = { op: filter.op, value: serializeFilterValue(filter.op, filter.value) };
      }
    }

    const hasMultipleFilters = Object.keys(filtersRecord).length > 1;

    onChange({
      schemaId,
      operation,
      field: requiresField ? field : undefined,
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      filterLogic: hasMultipleFilters ? filterLogic : undefined,
      groupBy: groupBy || undefined,
    });
  }, [schemaId, operation, field, requiresField, filters, filterLogic, groupBy, onChange]);

  const handleAddFilter = () => {
    setFilters([...filters, { field: '', op: 'eq', value: '' }]);
  };

  const handleRemoveFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const handleFilterChange = (index: number, updates: Partial<FilterEntry>) => {
    setFilters(filters.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Performs aggregation directly in the database using SQL. Much more efficient than loading
          all records into memory with Aggregate Data.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label>Source Schema</Label>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={setSchemaId} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="operation">Operation</Label>
        <Select
          value={operation}
          onValueChange={(v) => setOperation(v as DbAggregateHandlerConfig['operation'])}
        >
          <SelectTrigger id="operation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {requiresField && (
        <div className="space-y-2">
          <Label>Field to Aggregate</Label>
          <SchemaFieldPicker
            schemaId={schemaId}
            value={field}
            onChange={setField}
            placeholder="Select numeric field"
          />
          <p className="text-xs text-muted-foreground">
            {operation === 'array_length'
              ? 'The JSON array field to sum lengths across all matching records.'
              : 'The numeric field from matching records to use for the calculation.'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Group By (optional)</Label>
        <SchemaFieldPicker
          schemaId={schemaId}
          value={groupBy}
          onChange={setGroupBy}
          placeholder="No grouping"
        />
        <p className="text-xs text-muted-foreground">
          Group results by a field. Returns an array of {'{'} key, value {'}'} pairs instead of a single result.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Filters (optional)</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
            <Plus className="h-4 w-4 mr-1" />
            Add Filter
          </Button>
        </div>

        {filters.length > 0 && (
          <div className="space-y-2">
            {filters.map((filter, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <SchemaFieldPicker
                    schemaId={schemaId}
                    value={filter.field}
                    onChange={(f) => handleFilterChange(index, { field: f })}
                    placeholder="Select field"
                  />
                </div>
                <Select
                  value={filter.op}
                  onValueChange={(value) =>
                    handleFilterChange(index, { op: value as FilterConfig['op'] })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_OPS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1">
                  <ExpressionInput
                    value={filter.value}
                    onChange={(value) => handleFilterChange(index, { value })}
                    placeholder="Expression"
                    previousSteps={previousSteps}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveFilter(index)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {filters.length > 1 && (
              <div className="flex items-center gap-3 pt-2 border-t">
                <span className="text-sm text-muted-foreground">Match:</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={filterLogic === 'and' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterLogic('and')}
                    className="h-7 px-3"
                  >
                    All (AND)
                  </Button>
                  <Button
                    type="button"
                    variant={filterLogic === 'or' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterLogic('or')}
                    className="h-7 px-3"
                  >
                    Any (OR)
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {filterLogic === 'and'
                    ? 'All conditions must match'
                    : 'Any condition can match'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-muted/50 rounded-md text-sm">
        <p className="font-medium mb-1">Output:</p>
        <code className="text-xs whitespace-pre-wrap">
          {groupBy
            ? operation === 'count'
              ? `{ operation: "count", groupBy: "${groupBy}", results: [{ key: "<value>", value: <number> }, ...] }`
              : `{ operation: "${operation}", field: "${field || '<field>'}", groupBy: "${groupBy}", results: [{ key: "<value>", value: <number> }, ...] }`
            : operation === 'count'
              ? '{ operation: "count", result: <number> }'
              : `{ operation: "${operation}", field: "${field || '<field>'}", result: <number> }`}
        </code>
      </div>
    </div>
  );
}
