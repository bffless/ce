import { useState, useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, HelpCircle, AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SchemaPicker } from './SchemaPicker';
import { SchemaFieldPicker, useSchemaFields } from './SchemaFieldPicker';
import type { DataCreateHandlerConfig } from './types';

interface DataCreateConfigProps {
  config: Partial<DataCreateHandlerConfig>;
  onChange: (config: DataCreateHandlerConfig) => void;
  projectId: string;
}

interface FieldMapping {
  schemaField: string;
  expression: string;
}

export function DataCreateConfig({ config, onChange, projectId }: DataCreateConfigProps) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(() => {
    const existing = config.fields || {};
    const entries = Object.entries(existing);
    return entries.length > 0
      ? entries.map(([schemaField, expression]) => ({ schemaField, expression }))
      : [{ schemaField: '', expression: '' }];
  });

  // Get schema fields for validation
  const schemaFields = useSchemaFields(schemaId);

  // Track which fields are already used
  const usedFields = useMemo(
    () => fieldMappings.map((m) => m.schemaField).filter(Boolean),
    [fieldMappings],
  );

  // Check for required fields that aren't mapped
  const unmappedRequiredFields = useMemo(() => {
    const mappedFields = new Set(usedFields);
    return schemaFields
      .filter((f) => f.required && !mappedFields.has(f.name))
      .map((f) => f.name);
  }, [schemaFields, usedFields]);

  useEffect(() => {
    const fields: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      if (mapping.schemaField.trim()) {
        fields[mapping.schemaField.trim()] = mapping.expression;
      }
    }
    onChange({
      schemaId,
      fields,
    });
  }, [schemaId, fieldMappings, onChange]);

  // Reset mappings when schema changes
  const handleSchemaChange = (newSchemaId: string) => {
    setSchemaId(newSchemaId);
    // Reset to single empty mapping when schema changes
    setFieldMappings([{ schemaField: '', expression: '' }]);
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
    <TooltipProvider>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Target Schema</Label>
          <SchemaPicker projectId={projectId} value={schemaId} onChange={handleSchemaChange} />
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
                  <p>Map schema fields to expressions. Available paths:</p>
                  <ul className="list-disc list-inside mt-1 text-xs">
                    <li><code>input.fieldName</code> - Request input</li>
                    <li><code>user.id</code>, <code>user.email</code> - Current user</li>
                    <li><code>steps.stepName.field</code> - Previous step output</li>
                    <li><code>now()</code> - Current timestamp</li>
                    <li><code>uuid()</code> - Generate UUID</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleAddMapping}>
              <Plus className="h-4 w-4 mr-1" />
              Add Field
            </Button>
          </div>

          {/* Warning for unmapped required fields */}
          {unmappedRequiredFields.length > 0 && (
            <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              <div>
                <span className="text-yellow-700 font-medium">Required fields not mapped: </span>
                <span className="text-yellow-600">
                  {unmappedRequiredFields.join(', ')}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {fieldMappings.map((mapping, index) => {
              // Find the schema field to show its type
              const schemaField = schemaFields.find((f) => f.name === mapping.schemaField);

              return (
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
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={mapping.expression}
                      onChange={(e) => handleMappingChange(index, { expression: e.target.value })}
                      placeholder={schemaField ? getPlaceholderForType(schemaField.type) : 'input.fieldName'}
                      className="flex-1"
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
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Get placeholder text based on field type
 */
function getPlaceholderForType(type: string): string {
  switch (type) {
    case 'number':
      return 'input.quantity or 42';
    case 'boolean':
      return 'input.enabled or true';
    case 'email':
      return 'input.email or user.email';
    case 'datetime':
      return 'now() or input.date';
    case 'json':
      return 'input.metadata or {}';
    default:
      return 'input.fieldName';
  }
}
