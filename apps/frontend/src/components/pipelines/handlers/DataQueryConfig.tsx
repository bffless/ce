import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import type { DataQueryHandlerConfig, FilterConfig } from './types';

interface DataQueryConfigProps {
  config: Partial<DataQueryHandlerConfig>;
  onChange: (config: DataQueryHandlerConfig) => void;
  projectId: string;
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

export function DataQueryConfig({ config, onChange, projectId }: DataQueryConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
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
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      select,
      limit,
      offset,
      orderBy,
    });
  }, [schemaId, filters, limit, offset, orderByField, orderByDir, selectFields, onChange]);

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
                <Input
                  value={filter.field}
                  onChange={(e) => handleFilterChange(index, { field: e.target.value })}
                  placeholder="Field name"
                  className="flex-1"
                />
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
                <Input
                  value={filter.value}
                  onChange={(e) => handleFilterChange(index, { value: e.target.value })}
                  placeholder="Expression"
                  className="flex-1"
                />
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
          <Label htmlFor="orderByField">Order By</Label>
          <Input
            id="orderByField"
            value={orderByField}
            onChange={(e) => setOrderByField(e.target.value)}
            placeholder="Field name"
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
