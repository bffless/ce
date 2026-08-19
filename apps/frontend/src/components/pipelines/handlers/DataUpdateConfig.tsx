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
import type { DataUpdateHandlerConfig } from './types';
import { serializeFilterValue, displayFilterValue } from './filter-value';

interface DataUpdateConfigProps {
  config: Partial<DataUpdateHandlerConfig>;
  onChange: (config: DataUpdateHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FilterEntry {
  field: string;
  op: 'eq' | 'ne' | 'in';
  value: string;
}

interface FieldMapping {
  schemaField: string;
  expression: string;
}

export function DataUpdateConfig({
  config,
  onChange,
  projectId,
  previousSteps = [],
}: DataUpdateConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [recordId, setRecordId] = useState(config.recordId || '');
  const [single, setSingle] = useState(config.single || false);
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([field, conf]) => ({
          field,
          op: conf.op,
          value: displayFilterValue(conf.value),
        }))
      : [{ field: '', op: 'eq' as const, value: '' }];
  });
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>(config.filterLogic || 'and');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(() => {
    const existing = config.fields || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([schemaField, expression]) => ({ schemaField, expression }))
      : [{ schemaField: '', expression: '' }];
  });

  useEffect(() => {
    const filtersRecord: Record<string, { op: 'eq' | 'ne' | 'in'; value: string | string[] }> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = {
          op: filter.op,
          value: serializeFilterValue(filter.op, filter.value),
        };
      }
    }

    const fields: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      if (mapping.schemaField.trim()) {
        fields[mapping.schemaField.trim()] = mapping.expression;
      }
    }

    // Only include filterLogic if there are multiple filters
    const hasMultipleFilters = Object.keys(filtersRecord).length > 1;

    onChange({
      schemaId,
      recordId: recordId.trim() || undefined,
      single: single || undefined,
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      filterLogic: hasMultipleFilters ? filterLogic : undefined,
      fields,
    });
  }, [schemaId, recordId, single, filters, filterLogic, fieldMappings, onChange]);

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

  const handleAddMapping = () => {
    setFieldMappings([...fieldMappings, { schemaField: '', expression: '' }]);
  };

  const handleRemoveMapping = (index: number) => {
    if (fieldMappings.length > 1) {
      setFieldMappings(fieldMappings.filter((_, i) => i !== index));
    }
  };

  const handleMappingChange = (index: number, updates: Partial<FieldMapping>) => {
    setFieldMappings(fieldMappings.map((m, i) => (i === index ? { ...m, ...updates } : m)));
  };

  return (
    <div className="space-y-4">
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
          Update a specific record by its ID. Ignores filters when set.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="single">Return Single Object</Label>
          <p className="text-xs text-muted-foreground">
            Update only first match and return object instead of {'{ count, updated: [] }'}
          </p>
        </div>
        <Switch id="single" checked={single} onCheckedChange={setSingle} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Find Records (Filters)</Label>
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
                  handleFilterChange(index, { op: value as 'eq' | 'ne' | 'in' })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">Equals</SelectItem>
                  <SelectItem value="ne">Not Equals</SelectItem>
                  <SelectItem value="in">In (any of)</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1">
                <ExpressionInput
                  value={filter.value}
                  onChange={(value) => handleFilterChange(index, { value })}
                  placeholder={
                    filter.op === 'in' ? 'Expression, or comma-separated list' : 'Expression'
                  }
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
                {filterLogic === 'and' ? 'All conditions must match' : 'Any condition can match'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Update Fields</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleAddMapping}>
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
                  onChange={(schemaField) => handleMappingChange(index, { schemaField })}
                  placeholder="Select field"
                />
              </div>
              <span className="text-muted-foreground">=</span>
              <div className="flex-1">
                <ExpressionInput
                  value={mapping.expression}
                  onChange={(expression) => handleMappingChange(index, { expression })}
                  placeholder="New value expression"
                  previousSteps={previousSteps}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveMapping(index)}
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
  );
}
