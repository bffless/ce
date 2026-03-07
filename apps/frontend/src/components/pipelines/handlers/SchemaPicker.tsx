import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGetProjectSchemasQuery } from '@/services/pipelineSchemasApi';
import { Skeleton } from '@/components/ui/skeleton';

interface SchemaPickerProps {
  projectId: string;
  value: string;
  onChange: (schemaId: string) => void;
}

export function SchemaPicker({ projectId, value, onChange }: SchemaPickerProps) {
  const { data, isLoading, error } = useGetProjectSchemasQuery(projectId, {
    skip: !projectId,
  });

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load schemas
      </div>
    );
  }

  const schemas = data?.schemas || [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select a schema" />
      </SelectTrigger>
      <SelectContent>
        {schemas.length === 0 ? (
          <SelectItem value="__none" disabled>
            No schemas available
          </SelectItem>
        ) : (
          schemas.map((schema) => (
            <SelectItem key={schema.id} value={schema.id}>
              {schema.name} ({schema.recordCount} records)
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
