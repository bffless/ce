import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';

interface SchemaPickerProps {
  projectId: string;
  value: string | undefined;
  onChange: (schemaId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * SchemaPicker - Dropdown for selecting a pipeline schema.
 * Used in pipeline step configuration forms for data handlers.
 */
export function SchemaPicker({
  projectId,
  value,
  onChange,
  placeholder = 'Select a schema...',
  disabled = false,
}: SchemaPickerProps) {
  const { data, isLoading, error } = useGetProjectSchemasQuery(projectId, {
    skip: !projectId,
  });

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (error) {
    return (
      <Select disabled>
        <SelectTrigger className="text-destructive">
          <SelectValue placeholder="Failed to load schemas" />
        </SelectTrigger>
      </Select>
    );
  }

  const schemas = data?.schemas || [];

  if (schemas.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="No schemas available" />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {schemas.map((schema) => (
          <SelectItem key={schema.id} value={schema.id}>
            <div className="flex items-center justify-between gap-4">
              <span>{schema.name}</span>
              <span className="text-xs text-muted-foreground">
                {schema.fields.length} field{schema.fields.length === 1 ? '' : 's'}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
