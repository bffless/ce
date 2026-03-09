import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type { DataQueryHandlerConfig, FilterConfig } from './types';

interface DataQueryConfigProps {
  config: Partial<DataQueryHandlerConfig>;
  onChange: (config: DataQueryHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FilterEntry {
  field: string;
  op: FilterConfig['op'];
  value: string;
}

const FILTER_OPS: { value: FilterConfig['op']; label: string }[] = [
  { value: 'eq', label: 'Equals (=)' },
  { value: 'ne', label: 'Not Equals (!=)' },
  { value: 'gt', label: 'Greater Than (>)' },
  { value: 'gte', label: 'Greater or Equal (>=)' },
  { value: 'lt', label: 'Less Than (<)' },
  { value: 'lte', label: 'Less or Equal (<=)' },
  { value: 'like', label: 'Like (pattern)' },
];

export function DataQueryConfig({ config, onChange, projectId, previousSteps = [] }: DataQueryConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [recordId, setRecordId] = useState(config.recordId || '');
  const [single, setSingle] = useState(config.single || false);
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([field, conf]) => ({ field, op: conf.op, value: conf.value }))
      : [];
  });
  const [limit, setLimit] = useState<number | undefined>(config.limit);
  const [offset, setOffset] = useState<number | undefined>(config.offset);
  const [orderByField, setOrderByField] = useState(config.orderBy?.field || '');
  const [orderByDir, setOrderByDir] = useState<'asc' | 'desc'>(config.orderBy?.direction || 'desc');
  const [selectFields, setSelectFields] = useState(config.select?.join(', ') || '');

  useEffect(() => {
    const filtersRecord: Record<string, FilterConfig> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = { op: filter.op, value: filter.value };
      }
    }

    const select = selectFields.trim()
      ? selectFields.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const orderBy = orderByField.trim()
      ? { field: orderByField.trim(), direction: orderByDir }
      : undefined;

    onChange({
      schemaId,
      recordId: recordId.trim() || undefined,
      single: single || undefined,
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      select,
      limit,
      offset,
      orderBy,
    });
  }, [schemaId, recordId, single, filters, limit, offset, orderByField, orderByDir, selectFields, onChange]);

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
      <div className="space-y-2">
        <Label>Source Schema</Label>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={setSchemaId} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recordId">Record ID (optional)</Label>
        <Input
          id="recordId"
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          placeholder="Find by record ID (expression)"
        />
        <p className="text-xs text-muted-foreground">
          Find a specific record by its ID. Returns a single object or null. Ignores filters when set.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="single">Return Single Object</Label>
          <p className="text-xs text-muted-foreground">
            Return an object instead of an array (first match or null)
          </p>
        </div>
        <Switch
          id="single"
          checked={single}
          onCheckedChange={setSingle}
        />
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
                    onChange={(field) => handleFilterChange(index, { field })}
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
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Order By</Label>
          <SchemaFieldPicker
            schemaId={schemaId}
            value={orderByField}
            onChange={setOrderByField}
            placeholder="Select field"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orderByDir">Direction</Label>
          <Select value={orderByDir} onValueChange={(v) => setOrderByDir(v as 'asc' | 'desc')}>
            <SelectTrigger id="orderByDir">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="limit">Limit</Label>
          <Input
            id="limit"
            type="number"
            value={limit ?? ''}
            onChange={(e) => setLimit(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="100"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offset">Offset</Label>
          <Input
            id="offset"
            type="number"
            value={offset ?? ''}
            onChange={(e) => setOffset(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="selectFields">Select Fields (optional)</Label>
        <Input
          id="selectFields"
          value={selectFields}
          onChange={(e) => setSelectFields(e.target.value)}
          placeholder="field1, field2, field3"
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated list of fields to return. Leave empty for all fields.
        </p>
      </div>
    </div>
  );
}
