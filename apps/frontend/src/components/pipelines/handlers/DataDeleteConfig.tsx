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
import { SchemaFieldPicker } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type { DataDeleteHandlerConfig } from './types';

interface DataDeleteConfigProps {
  config: Partial<DataDeleteHandlerConfig>;
  onChange: (config: DataDeleteHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FilterEntry {
  field: string;
  op: 'eq' | 'ne';
  value: string;
}

export function DataDeleteConfig({ config, onChange, projectId, previousSteps = [] }: DataDeleteConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [recordId, setRecordId] = useState(config.recordId || '');
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([field, conf]) => ({ field, op: conf.op, value: conf.value }))
      : [{ field: '', op: 'eq' as const, value: '' }];
  });
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>(config.filterLogic || 'and');

  useEffect(() => {
    const filtersRecord: Record<string, { op: 'eq' | 'ne'; value: string }> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = { op: filter.op, value: filter.value };
      }
    }

    // Only include filterLogic if there are multiple filters
    const hasMultipleFilters = Object.keys(filtersRecord).length > 1;

    onChange({
      schemaId,
      recordId: recordId.trim() || undefined,
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      filterLogic: hasMultipleFilters ? filterLogic : undefined,
    });
  }, [schemaId, recordId, filters, filterLogic, onChange]);

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
        <Label htmlFor="recordId">Record ID (optional)</Label>
        <Input
          id="recordId"
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          placeholder="Find by record ID (expression)"
        />
        <p className="text-xs text-muted-foreground">
          Delete a specific record by its ID. Ignores filters when set.
        </p>
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
                disabled={filters.length === 1}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {/* Filter logic selector - only show when 2+ filters */}
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
        <p className="text-xs text-muted-foreground">
          All records matching these filters will be deleted.
        </p>
      </div>
    </div>
  );
}
