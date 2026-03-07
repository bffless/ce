import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SchemaPicker } from './SchemaPicker';
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label>Field Mappings</Label>
            <Tooltip>
              <TooltipTrigger>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
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

        <div className="space-y-2">
          {fieldMappings.map((mapping, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={mapping.schemaField}
                onChange={(e) => handleMappingChange(index, { schemaField: e.target.value })}
                placeholder="Schema field"
                className="flex-1"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                value={mapping.expression}
                onChange={(e) => handleMappingChange(index, { expression: e.target.value })}
                placeholder="input.fieldName"
                className="flex-1"
              />
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
