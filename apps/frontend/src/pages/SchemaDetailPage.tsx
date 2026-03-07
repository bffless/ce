import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { useGetSchemaQuery, useDeleteSchemaMutation, downloadSchemaExport } from '@/services/pipelineSchemasApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { SchemaFieldsTable } from '@/components/data/SchemaFieldsTable';
import { DataBrowser } from '@/components/data/DataBrowser';

/**
 * SchemaDetailPage - Shows schema details and data records.
 * Route: /repo/:owner/:repo/data/:schemaId
 */
export function SchemaDetailPage() {
  const { owner, repo, schemaId } = useParams<{
    owner: string;
    repo: string;
    schemaId: string;
  }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canEdit, canAdmin } = useProjectRole(owner!, repo!);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch schema
  const { data: schema, isLoading, error } = useGetSchemaQuery(schemaId || '', {
    skip: !schemaId,
  });

  // Delete mutation
  const [deleteSchema, { isLoading: isDeleting }] = useDeleteSchemaMutation();

  const handleDelete = async () => {
    if (!schema) return;
    try {
      await deleteSchema(schema.id).unwrap();
      toast({
        title: 'Schema deleted',
        description: `Schema "${schema.name}" and all its data have been deleted.`,
      });
      navigate(`/repo/${owner}/${repo}/data`);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete schema';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    if (!schema) return;
    setIsExporting(true);
    try {
      await downloadSchemaExport(schema.id, format);
      toast({
        title: 'Export complete',
        description: `Data exported as ${format.toUpperCase()}`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not export data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error || !schema) {
    return (
      <div className="space-y-6">
        <Link
          to={`/repo/${owner}/${repo}/data`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Schemas
        </Link>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive">
              {error ? 'Failed to load schema' : 'Schema not found'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate(`/repo/${owner}/${repo}/data`)}
            >
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Back link and actions */}
        <div className="flex items-center justify-between">
          <Link
            to={`/repo/${owner}/${repo}/data`}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Schemas
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => handleExport('json')}
              disabled={isExporting || schema.recordCount === 0}
            >
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => handleExport('csv')}
              disabled={isExporting || schema.recordCount === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate(`/repo/${owner}/${repo}/data/${schemaId}/edit`)}
              >
                <Pencil className="h-4 w-4" />
                Edit Schema
              </Button>
            )}
            {canAdmin && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Schema info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {schema.name}
                  <Badge variant="secondary">{schema.recordCount} records</Badge>
                </CardTitle>
                <CardDescription>
                  Created {new Date(schema.createdAt).toLocaleDateString()}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <h4 className="text-sm font-medium mb-2">Fields</h4>
            <SchemaFieldsTable fields={schema.fields} />
          </CardContent>
        </Card>

        {/* Data browser */}
        <DataBrowser schemaId={schema.id} fields={schema.fields} canEdit={canEdit} />
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schema</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the schema "{schema.name}"?
              {schema.recordCount > 0 &&
                ` This will also delete ${schema.recordCount} data record${schema.recordCount === 1 ? '' : 's'}.`}{' '}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
