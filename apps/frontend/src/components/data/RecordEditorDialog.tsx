import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateRecordMutation,
  useUpdateRecordMutation,
  SchemaField,
  PipelineDataRecord,
} from '@/services/pipelineSchemasApi';

interface RecordEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schemaId: string;
  fields: SchemaField[];
  record?: PipelineDataRecord | null;
  onSuccess?: () => void;
}

export function RecordEditorDialog({
  open,
  onOpenChange,
  schemaId,
  fields,
  record,
  onSuccess,
}: RecordEditorDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const [createRecord, { isLoading: isCreating }] = useCreateRecordMutation();
  const [updateRecord, { isLoading: isUpdating }] = useUpdateRecordMutation();

  const isLoading = isCreating || isUpdating;
  const isEditing = !!record;

  // Initialize form data when dialog opens or record changes
  useEffect(() => {
    if (open) {
      if (record) {
        setFormData(record.data);
      } else {
        // Initialize with defaults
        const defaults: Record<string, unknown> = {};
        for (const field of fields) {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          } else {
            // Set sensible defaults based on type
            switch (field.type) {
              case 'boolean':
                defaults[field.name] = false;
                break;
              case 'number':
                defaults[field.name] = '';
                break;
              case 'json':
                defaults[field.name] = '{}';
                break;
              default:
                defaults[field.name] = '';
            }
          }
        }
        setFormData(defaults);
      }
    }
  }, [open, record, fields]);

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Process form data - convert types as needed
    const processedData: Record<string, unknown> = {};
    for (const field of fields) {
      const value = formData[field.name];

      switch (field.type) {
        case 'number':
          processedData[field.name] = value === '' ? null : Number(value);
          break;
        case 'boolean':
          processedData[field.name] = Boolean(value);
          break;
        case 'json':
          try {
            processedData[field.name] =
              typeof value === 'string' ? JSON.parse(value) : value;
          } catch {
            toast({
              title: 'Invalid JSON',
              description: `Field "${field.name}" contains invalid JSON`,
              variant: 'destructive',
            });
            return;
          }
          break;
        default:
          processedData[field.name] = value;
      }
    }

    try {
      if (isEditing) {
        await updateRecord({
          schemaId,
          recordId: record.id,
          data: processedData,
        }).unwrap();
        toast({
          title: 'Record updated',
          description: 'The record has been updated successfully.',
        });
      } else {
        await createRecord({
          schemaId,
          data: processedData,
        }).unwrap();
        toast({
          title: 'Record created',
          description: 'The record has been created successfully.',
        });
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        `Failed to ${isEditing ? 'update' : 'create'} record`;
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const renderField = (field: SchemaField) => {
    const value = formData[field.name];

    switch (field.type) {
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              id={field.name}
              checked={Boolean(value)}
              onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
            />
            <Label htmlFor={field.name} className="text-sm">
              {value ? 'True' : 'False'}
            </Label>
          </div>
        );

      case 'text':
      case 'json':
        return (
          <Textarea
            id={field.name}
            value={
              field.type === 'json' && typeof value === 'object'
                ? JSON.stringify(value, null, 2)
                : String(value ?? '')
            }
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.type === 'json' ? '{}' : ''}
            rows={4}
            className="font-mono text-sm"
          />
        );

      case 'number':
        return (
          <Input
            id={field.name}
            type="number"
            value={String(value ?? '')}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder="0"
          />
        );

      case 'datetime':
        return (
          <Input
            id={field.name}
            type="datetime-local"
            value={
              value
                ? new Date(value as string).toISOString().slice(0, 16)
                : ''
            }
            onChange={(e) =>
              handleFieldChange(
                field.name,
                e.target.value ? new Date(e.target.value).toISOString() : '',
              )
            }
          />
        );

      case 'email':
        return (
          <Input
            id={field.name}
            type="email"
            value={String(value ?? '')}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder="email@example.com"
          />
        );

      default:
        return (
          <Input
            id={field.name}
            type="text"
            value={String(value ?? '')}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          />
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Record' : 'Create Record'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {fields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name} className="flex items-center gap-2">
                  {field.name}
                  {field.required && (
                    <span className="text-destructive text-xs">*</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    ({field.type})
                  </span>
                </Label>
                {renderField(field)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading
                ? isEditing
                  ? 'Saving...'
                  : 'Creating...'
                : isEditing
                  ? 'Save Changes'
                  : 'Create Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
