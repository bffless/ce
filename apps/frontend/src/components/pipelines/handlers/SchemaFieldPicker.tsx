import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGetSchemaQuery, type SchemaField } from '@/services/pipelineSchemasApi';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface SchemaFieldPickerProps {
  schemaId: string;
  value: string;
  onChange: (fieldName: string) => void;
  /** Fields already used in other mappings (to show as disabled or indicate reuse) */
  usedFields?: string[];
  placeholder?: string;
}

const TYPE_COLORS: Record<string, string> = {
  string: 'bg-green-500/10 text-green-700',
  number: 'bg-blue-500/10 text-blue-700',
  boolean: 'bg-purple-500/10 text-purple-700',
  email: 'bg-orange-500/10 text-orange-700',
  text: 'bg-green-500/10 text-green-700',
  datetime: 'bg-yellow-500/10 text-yellow-700',
  json: 'bg-gray-500/10 text-gray-700',
};

export function SchemaFieldPicker({
  schemaId,
  value,
  onChange,
  usedFields = [],
  placeholder = 'Select field',
}: SchemaFieldPickerProps) {
  const { data: schema, isLoading, error } = useGetSchemaQuery(schemaId, {
    skip: !schemaId,
  });

  if (!schemaId) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Select schema first" />
        </SelectTrigger>
      </Select>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (error) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Failed to load fields" />
        </SelectTrigger>
      </Select>
    );
  }

  const fields = schema?.fields || [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {fields.length === 0 ? (
          <SelectItem value="__none" disabled>
            No fields in schema
          </SelectItem>
        ) : (
          fields.map((field) => {
            const isUsed = usedFields.includes(field.name) && field.name !== value;
            return (
              <SelectItem
                key={field.name}
                value={field.name}
                disabled={isUsed}
              >
                <div className="flex items-center gap-2">
                  <span>{field.name}</span>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[field.type] || ''}`}
                  >
                    {field.type}
                  </Badge>
                  {field.required && (
                    <span className="text-destructive text-xs">*</span>
                  )}
                  {isUsed && (
                    <span className="text-xs text-muted-foreground">(already mapped)</span>
                  )}
                </div>
              </SelectItem>
            );
          })
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * Hook to get schema fields for validation/display purposes
 */
export function useSchemaFields(schemaId: string): SchemaField[] {
  const { data: schema } = useGetSchemaQuery(schemaId, {
    skip: !schemaId,
  });
  return schema?.fields || [];
}
