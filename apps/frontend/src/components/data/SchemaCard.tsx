import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Database } from 'lucide-react';
import { PipelineSchemaWithCount } from '@/services/pipelineSchemasApi';

interface SchemaCardProps {
  schema: PipelineSchemaWithCount;
  href: string;
}

export function SchemaCard({ schema, href }: SchemaCardProps) {
  return (
    <Link to={href}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{schema.name}</h3>
              <Badge variant="secondary" className="shrink-0">
                {schema.recordCount} records
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {schema.fields.length} field{schema.fields.length === 1 ? '' : 's'}:{' '}
              {schema.fields
                .slice(0, 3)
                .map((f) => f.name)
                .join(', ')}
              {schema.fields.length > 3 && `, +${schema.fields.length - 3} more`}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
