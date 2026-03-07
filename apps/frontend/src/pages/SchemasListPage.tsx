import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Database, MoreHorizontal, Trash2, Pencil } from 'lucide-react';
import { useGetProjectSchemasQuery, useDeleteSchemaMutation } from '@/services/pipelineSchemasApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { SchemaCard } from '@/components/data/SchemaCard';

/**
 * SchemasListPage - Content for the Data tab showing all schemas.
 * Rendered inside RepositoryLayout via Outlet.
 * Route: /repo/:owner/:repo/data
 */
export function SchemasListPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);
  const [deletingSchema, setDeletingSchema] = useState<{
    id: string;
    name: string;
    recordCount: number;
  } | null>(null);

  // Fetch project to get projectId
  const { data: project, isLoading: isLoadingProject } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );

  // Fetch schemas for this project
  const {
    data: schemasData,
    isLoading: isLoadingSchemas,
    error: schemasError,
  } = useGetProjectSchemasQuery(project?.id || '', {
    skip: !project?.id,
  });

  // Delete mutation
  const [deleteSchema, { isLoading: isDeleting }] = useDeleteSchemaMutation();

  const handleDelete = async () => {
    if (!deletingSchema) return;
    try {
      await deleteSchema(deletingSchema.id).unwrap();
      toast({
        title: 'Schema deleted',
        description: `Schema "${deletingSchema.name}" and all its data have been deleted.`,
      });
      setDeletingSchema(null);
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

  const isLoading = isLoadingProject || isLoadingSchemas;
  const schemas = schemasData?.schemas || [];

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Schemas</CardTitle>
          <CardDescription>Manage data structures for pipeline handlers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-40" />
            </div>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (schemasError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Schemas</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load schemas</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Data Schemas</CardTitle>
            <CardDescription>Manage data structures for pipeline handlers</CardDescription>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => navigate(`/repo/${owner}/${repo}/data/new`)}
            >
              <Plus className="h-4 w-4" />
              Create Schema
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {schemas.length === 0 ? (
            <div className="p-8 text-center">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium">No data schemas found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {canEdit
                  ? 'Create a schema to define data structures that pipeline handlers can store'
                  : 'No data schemas have been created for this repository yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {schemas.map((schema) => (
                <div key={schema.id} className="relative">
                  <SchemaCard
                    schema={schema}
                    href={`/repo/${owner}/${repo}/data/${schema.id}`}
                  />
                  {canEdit && (
                    <div className="absolute right-12 top-1/2 -translate-y-1/2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/repo/${owner}/${repo}/data/${schema.id}/edit`);
                            }}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit Schema
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingSchema({
                                id: schema.id,
                                name: schema.name,
                                recordCount: schema.recordCount,
                              });
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      {canEdit && (
        <AlertDialog open={!!deletingSchema} onOpenChange={(open) => !open && setDeletingSchema(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Schema</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the schema "{deletingSchema?.name}"?
                {deletingSchema?.recordCount
                  ? ` This will also delete ${deletingSchema.recordCount} data record${deletingSchema.recordCount === 1 ? '' : 's'}.`
                  : ''}{' '}
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
      )}
    </>
  );
}
