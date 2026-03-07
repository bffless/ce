import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SchemaField } from '@/services/pipelineSchemasApi';

interface SchemaFieldsTableProps {
  fields: SchemaField[];
}

const FIELD_TYPE_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  string: { label: 'String', variant: 'outline' },
  text: { label: 'Text', variant: 'outline' },
  number: { label: 'Number', variant: 'secondary' },
  boolean: { label: 'Boolean', variant: 'secondary' },
  email: { label: 'Email', variant: 'default' },
  datetime: { label: 'DateTime', variant: 'secondary' },
  json: { label: 'JSON', variant: 'outline' },
};

export function SchemaFieldsTable({ fields }: SchemaFieldsTableProps) {
  if (fields.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">No fields defined</div>
    );
  }

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Default</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => {
            const typeInfo = FIELD_TYPE_LABELS[field.type] || {
              label: field.type,
              variant: 'outline' as const,
            };
            return (
              <TableRow key={index}>
                <TableCell className="font-mono text-sm">{field.name}</TableCell>
                <TableCell>
                  <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
                </TableCell>
                <TableCell>
                  {field.required ? (
                    <Badge variant="default">Required</Badge>
                  ) : (
                    <span className="text-muted-foreground">Optional</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {field.default !== undefined ? (
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      {JSON.stringify(field.default)}
                    </code>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
