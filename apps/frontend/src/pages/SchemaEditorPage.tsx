import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  useGetSchemaQuery,
  useCreateSchemaMutation,
  useUpdateSchemaMutation,
  SchemaField,
  SchemaFieldType,
} from '@/services/pipelineSchemasApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useToast } from '@/hooks/use-toast';

const FIELD_TYPES: { value: SchemaFieldType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'text', label: 'Text (Long)' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'email', label: 'Email' },
  { value: 'datetime', label: 'DateTime' },
  { value: 'json', label: 'JSON' },
];

/**
 * SchemaEditorPage - Create or edit a schema.
 * Route: /repo/:owner/:repo/data/new (create)
 * Route: /repo/:owner/:repo/data/:schemaId/edit (edit)
 */
export function SchemaEditorPage() {
  const { owner, repo, schemaId } = useParams<{
    owner: string;
    repo: string;
    schemaId?: string;
  }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEditing = !!schemaId;

  // Form state
  const [name, setName] = useState('');
  const [fields, setFields] = useState<SchemaField[]>([
    { name: '', type: 'string', required: false },
  ]);

  // Fetch project for projectId
  const { data: project, isLoading: isLoadingProject } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );

  // Fetch existing schema if editing
  const { data: existingSchema, isLoading: isLoadingSchema } = useGetSchemaQuery(schemaId || '', {
    skip: !schemaId,
  });

  // Mutations
  const [createSchema, { isLoading: isCreating }] = useCreateSchemaMutation();
  const [updateSchema, { isLoading: isUpdating }] = useUpdateSchemaMutation();

  // Populate form when editing
  useEffect(() => {
    if (existingSchema) {
      setName(existingSchema.name);
      setFields(existingSchema.fields.length > 0 ? existingSchema.fields : [{ name: '', type: 'string', required: false }]);
    }
  }, [existingSchema]);

  const handleAddField = () => {
    setFields([...fields, { name: '', type: 'string', required: false }]);
  };

  const handleRemoveField = (index: number) => {
    if (fields.length > 1) {
      setFields(fields.filter((_, i) => i !== index));
    }
  };

  const handleFieldChange = (index: number, updates: Partial<SchemaField>) => {
    setFields(fields.map((field, i) => (i === index ? { ...field, ...updates } : field)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!name.trim()) {
      toast({
        title: 'Validation error',
        description: 'Schema name is required',
        variant: 'destructive',
      });
      return;
    }

    const validFields = fields.filter((f) => f.name.trim());
    if (validFields.length === 0) {
      toast({
        title: 'Validation error',
        description: 'At least one field with a name is required',
        variant: 'destructive',
      });
      return;
    }

    // Check for duplicate field names
    const fieldNames = validFields.map((f) => f.name.trim().toLowerCase());
    const uniqueNames = new Set(fieldNames);
    if (uniqueNames.size !== fieldNames.length) {
      toast({
        title: 'Validation error',
        description: 'Field names must be unique',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (isEditing) {
        await updateSchema({
          id: schemaId!,
          data: { name: name.trim(), fields: validFields },
        }).unwrap();
        toast({
          title: 'Schema updated',
          description: `Schema "${name}" has been updated.`,
        });
        navigate(`/repo/${owner}/${repo}/data/${schemaId}`);
      } else {
        const result = await createSchema({
          projectId: project!.id,
          name: name.trim(),
          fields: validFields,
        }).unwrap();
        toast({
          title: 'Schema created',
          description: `Schema "${name}" has been created.`,
        });
        navigate(`/repo/${owner}/${repo}/data/${result.id}`);
      }
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        `Failed to ${isEditing ? 'update' : 'create'} schema`;
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const isLoading = isLoadingProject || (isEditing && isLoadingSchema);
  const isSaving = isCreating || isUpdating;

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to={isEditing ? `/repo/${owner}/${repo}/data/${schemaId}` : `/repo/${owner}/${repo}/data`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        {isEditing ? 'Back to Schema' : 'Back to Schemas'}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit Schema' : 'Create Schema'}</CardTitle>
          <CardDescription>
            {isEditing
              ? 'Update the schema definition. Existing data will be preserved.'
              : 'Define a new data schema for pipeline handlers to use.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Schema name */}
            <div className="space-y-2">
              <Label htmlFor="name">Schema Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., contacts, submissions"
                className="max-w-md"
              />
            </div>

            {/* Fields */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Fields</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddField}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Field
                </Button>
              </div>

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 border rounded-md bg-muted/30"
                  >
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Name</Label>
                        <Input
                          value={field.name}
                          onChange={(e) => handleFieldChange(index, { name: e.target.value })}
                          placeholder="field_name"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={(value) =>
                            handleFieldChange(index, { type: value as SchemaFieldType })
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
                            checked={field.required}
                            onCheckedChange={(checked) =>
                              handleFieldChange(index, { required: !!checked })
                            }
                          />
                          <span className="ml-2 text-sm text-muted-foreground">Required</span>
                        </div>
                      </div>
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
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate(
                    isEditing
                      ? `/repo/${owner}/${repo}/data/${schemaId}`
                      : `/repo/${owner}/${repo}/data`,
                  )
                }
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : isEditing ? 'Update Schema' : 'Create Schema'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
