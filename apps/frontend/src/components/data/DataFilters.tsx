import { useState } from 'react';
import { Filter, Plus, X, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SchemaField, FieldFilter } from '@/services/pipelineSchemasApi';

interface ActiveFilter {
  field: string;
  op: FieldFilter['op'];
  value: string;
}

interface DataFiltersProps {
  fields: SchemaField[];
  filters: Record<string, FieldFilter>;
  createdAfter?: string;
  createdBefore?: string;
  onFiltersChange: (filters: Record<string, FieldFilter>) => void;
  onDateFiltersChange: (createdAfter?: string, createdBefore?: string) => void;
  onClearAll: () => void;
}

const operatorsByType: Record<string, { value: FieldFilter['op']; label: string }[]> = {
  string: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'like', label: 'contains' },
  ],
  email: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'like', label: 'contains' },
  ],
  text: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'like', label: 'contains' },
  ],
  number: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'gt', label: 'greater than' },
    { value: 'lt', label: 'less than' },
    { value: 'gte', label: 'greater or equal' },
    { value: 'lte', label: 'less or equal' },
  ],
  boolean: [
    { value: 'eq', label: 'equals' },
  ],
  datetime: [
    { value: 'gt', label: 'after' },
    { value: 'lt', label: 'before' },
    { value: 'gte', label: 'on or after' },
    { value: 'lte', label: 'on or before' },
  ],
  json: [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'like', label: 'contains' },
  ],
};

function getOperatorsForField(field: SchemaField) {
  return operatorsByType[field.type] || operatorsByType.string;
}

function formatOperator(op: FieldFilter['op']): string {
  const labels: Record<FieldFilter['op'], string> = {
    eq: '=',
    ne: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'contains',
  };
  return labels[op];
}

export function DataFilters({
  fields,
  filters,
  createdAfter,
  createdBefore,
  onFiltersChange,
  onDateFiltersChange,
  onClearAll,
}: DataFiltersProps) {
  const [open, setOpen] = useState(false);
  const [newFilter, setNewFilter] = useState<Partial<ActiveFilter>>({});

  const activeFilters: ActiveFilter[] = Object.entries(filters).map(([field, f]) => ({
    field,
    op: f.op,
    value: f.value,
  }));

  const hasActiveFilters = activeFilters.length > 0 || createdAfter || createdBefore;

  const handleAddFilter = () => {
    if (!newFilter.field || !newFilter.op || !newFilter.value) return;

    const updatedFilters = {
      ...filters,
      [newFilter.field]: { op: newFilter.op, value: newFilter.value },
    };
    onFiltersChange(updatedFilters);
    setNewFilter({});
  };

  const handleRemoveFilter = (field: string) => {
    const updatedFilters = { ...filters };
    delete updatedFilters[field];
    onFiltersChange(updatedFilters);
  };

  const selectedField = fields.find((f) => f.name === newFilter.field);
  const availableOperators = selectedField ? getOperatorsForField(selectedField) : [];

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0">
                {activeFilters.length + (createdAfter ? 1 : 0) + (createdBefore ? 1 : 0)}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96" align="start">
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Filter Records</h4>

            {/* Date Filters */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Created Date
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">After</Label>
                  <Input
                    type="date"
                    value={createdAfter ? createdAfter.split('T')[0] : ''}
                    onChange={(e) =>
                      onDateFiltersChange(
                        e.target.value ? new Date(e.target.value).toISOString() : undefined,
                        createdBefore,
                      )
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Before</Label>
                  <Input
                    type="date"
                    value={createdBefore ? createdBefore.split('T')[0] : ''}
                    onChange={(e) =>
                      onDateFiltersChange(
                        createdAfter,
                        e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      )
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Field Filters */}
            {activeFilters.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Active Filters</Label>
                <div className="space-y-1">
                  {activeFilters.map((f) => (
                    <div
                      key={f.field}
                      className="flex items-center justify-between bg-muted/50 rounded px-2 py-1 text-sm"
                    >
                      <span>
                        <span className="font-medium">{f.field}</span>{' '}
                        <span className="text-muted-foreground">{formatOperator(f.op)}</span>{' '}
                        <span className="text-muted-foreground">"{f.value}"</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => handleRemoveFilter(f.field)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add New Filter */}
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs text-muted-foreground">Add Filter</Label>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={newFilter.field || ''}
                  onValueChange={(value) => setNewFilter({ field: value, op: undefined, value: '' })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.name} value={field.name}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={newFilter.op || ''}
                  onValueChange={(value) => setNewFilter({ ...newFilter, op: value as FieldFilter['op'] })}
                  disabled={!newFilter.field}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Op" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOperators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1">
                  {selectedField?.type === 'boolean' ? (
                    <Select
                      value={newFilter.value || ''}
                      onValueChange={(value) => setNewFilter({ ...newFilter, value })}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Value" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={newFilter.value || ''}
                      onChange={(e) => setNewFilter({ ...newFilter, value: e.target.value })}
                      placeholder="Value"
                      className="h-8 text-xs flex-1"
                      disabled={!newFilter.field}
                    />
                  )}
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleAddFilter}
                    disabled={!newFilter.field || !newFilter.op || !newFilter.value}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear All
        </Button>
      )}
    </div>
  );
}
