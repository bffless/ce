import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import type { FormHandlerConfig, FormFieldConfig } from './types';

interface FormHandlerConfigProps {
  config: Partial<FormHandlerConfig>;
  onChange: (config: FormHandlerConfig) => void;
}

interface FieldEntry {
  name: string;
  config: FormFieldConfig;
}

const FIELD_TYPES: { value: FormFieldConfig['type']; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'boolean', label: 'Boolean' },
];

export function FormHandlerConfig({ config, onChange }: FormHandlerConfigProps) {
  const [fields, setFields] = useState<FieldEntry[]>(() => {
    const existingFields = config.fields || {};
    const entries = Object.entries(existingFields);
    return entries.length > 0
      ? entries.map(([name, conf]) => ({ name, config: conf }))
      : [{ name: '', config: { type: 'string', required: false } }];
  });
  const [honeypotField, setHoneypotField] = useState(config.honeypotField || '');

  useEffect(() => {
    const fieldsRecord: Record<string, FormFieldConfig> = {};
    for (const field of fields) {
      if (field.name.trim()) {
        fieldsRecord[field.name.trim()] = field.config;
      }
    }
    onChange({
      fields: fieldsRecord,
      honeypotField: honeypotField.trim() || undefined,
    });
  }, [fields, honeypotField, onChange]);

  const handleAddField = () => {
    setFields([...fields, { name: '', config: { type: 'string', required: false } }]);
  };

  const handleRemoveField = (index: number) => {
    if (fields.length > 1) {
      setFields(fields.filter((_, i) => i !== index));
    }
  };

  const handleFieldNameChange = (index: number, name: string) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, name } : f)));
  };

  const handleFieldConfigChange = (index: number, updates: Partial<FormFieldConfig>) => {
    setFields(
      fields.map((f, i) => (i === index ? { ...f, config: { ...f.config, ...updates } } : f)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Field Validations</Label>
        <Button type="button" variant="outline" size="sm" onClick={handleAddField}>
          <Plus className="h-4 w-4 mr-1" />
          Add Field
        </Button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={index} className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Field Name</Label>
                <Input
                  value={field.name}
                  onChange={(e) => handleFieldNameChange(index, e.target.value)}
                  placeholder="field_name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={field.config.type}
                  onValueChange={(value) =>
                    handleFieldConfigChange(index, { type: value as FormFieldConfig['type'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Required</Label>
                <div className="flex items-center h-10">
                  <Checkbox
                    checked={field.config.required}
                    onCheckedChange={(checked) =>
                      handleFieldConfigChange(index, { required: !!checked })
                    }
                  />
                </div>
              </div>
              {(field.config.type === 'string' || field.config.type === 'number') && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {field.config.type === 'number' ? 'Min Value' : 'Min Length'}
                    </Label>
                    <Input
                      type="number"
                      value={field.config.min ?? ''}
                      onChange={(e) =>
                        handleFieldConfigChange(index, {
                          min: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="--"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {field.config.type === 'number' ? 'Max Value' : 'Max Length'}
                    </Label>
                    <Input
                      type="number"
                      value={field.config.max ?? ''}
                      onChange={(e) =>
                        handleFieldConfigChange(index, {
                          max: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="--"
                    />
                  </div>
                </>
              )}
              {field.config.type === 'string' && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Pattern (Regex)</Label>
                  <Input
                    value={field.config.pattern || ''}
                    onChange={(e) =>
                      handleFieldConfigChange(index, {
                        pattern: e.target.value || undefined,
                      })
                    }
                    placeholder="^[a-z]+$"
                  />
                </div>
              )}
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveField(index)}
                  disabled={fields.length === 1}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-2 border-t">
        <Label htmlFor="honeypotField">Honeypot Field (Spam Protection)</Label>
        <Input
          id="honeypotField"
          value={honeypotField}
          onChange={(e) => setHoneypotField(e.target.value)}
          placeholder="e.g., website (optional)"
          className="max-w-md"
        />
        <p className="text-xs text-muted-foreground">
          If this field is filled, the submission will be rejected. Bots often fill hidden fields.
        </p>
      </div>
    </div>
  );
}
