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
import { SchemaFieldPicker } from './SchemaFieldPicker';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';
import type { DataUpdateHandlerConfig } from './types';

interface DataUpdateConfigProps {
  config: Partial<DataUpdateHandlerConfig>;
  onChange: (config: DataUpdateHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface FilterEntry {
  field: string;
  op: 'eq' | 'ne';
  value: string;
}

interface FieldMapping {
  schemaField: string;
  expression: string;
}

export function DataUpdateConfig({ config, onChange, projectId, previousSteps = [] }: DataUpdateConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [recordId, setRecordId] = useState(config.recordId || '');
  const [filters, setFilters] = useState<FilterEntry[]>(() => {
    const existing = config.filters || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([field, conf]) => ({ field, op: conf.op, value: conf.value }))
      : [{ field: '', op: 'eq' as const, value: '' }];
  });
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(() => {
    const existing = config.fields || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([schemaField, expression]) => ({ schemaField, expression }))
      : [{ schemaField: '', expression: '' }];
  });

  useEffect(() => {
    const filtersRecord: Record<string, { op: 'eq' | 'ne'; value: string }> = {};
    for (const filter of filters) {
      if (filter.field.trim()) {
        filtersRecord[filter.field.trim()] = { op: filter.op, value: filter.value };
      }
    }

    const fields: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      if (mapping.schemaField.trim()) {
        fields[mapping.schemaField.trim()] = mapping.expression;
      }
    }

    onChange({
      schemaId,
      recordId: recordId.trim() || undefined,
      filters: Object.keys(filtersRecord).length > 0 ? filtersRecord : undefined,
      fields,
    });
  }, [schemaId, recordId, filters, fieldMappings, onChange]);

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
    setFieldMappings(
      fieldMappings.map((m, i) => (i === index ? { ...m, ...updates } : m)),
    );
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
