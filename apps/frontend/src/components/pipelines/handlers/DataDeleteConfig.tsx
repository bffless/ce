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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import type { DataDeleteHandlerConfig } from './types';

interface DataDeleteConfigProps {
  config: Partial<DataDeleteHandlerConfig>;
  onChange: (config: DataDeleteHandlerConfig) => void;
  projectId: string;
}

interface FilterEntry {
  field: string;
  op: 'eq' | 'ne';
  value: string;
}

export function DataDeleteConfig({ config, onChange, projectId }: DataDeleteConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([field, conf]) => ({ field, op: conf.op, value: conf.value }))
      : [{ field: '', op: 'eq' as const, value: '' }];
  });

  useEffect(() => {
    const filtersRecord: Record<string, { op: 'eq' | 'ne'; value: string }> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = { op: filter.op, value: filter.value };
      }
    }

    onChange({
      schemaId,
      filters: filtersRecord,
    });
  }, [schemaId, filters, onChange]);

  const handleAddFilter = () => {
    setFilters([...filters, { field: '', op: 'eq', value: '' }]);
  };

  const handleRemoveFilter = (index: number) => {
    if (filters.length > 1) {
      setFilters(filters.filter((_, i) => i !== index));
    }
  };

  const handleFilterChange = (index: number, updates: Partial<FilterEntry>) => {
    setFilters(filters.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This handler permanently deletes records. Make sure your filters are correct.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label>Target Schema</Label>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={setSchemaId} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Find Records to Delete (Filters)</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
            <Plus className="h-4 w-4 mr-1" />
            Add Filter
          </Button>
        </div>

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
                  handleFilterChange(index, { op: value as 'eq' | 'ne' })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">Equals</SelectItem>
                  <SelectItem value="ne">Not Equals</SelectItem>
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
                disabled={filters.length === 1}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          All records matching these filters will be deleted.
        </p>
      </div>
    </div>
  );
}
