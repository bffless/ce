import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Trash2, Copy, ChevronLeft, ChevronRight, Image } from 'lucide-react';
import {
  useGetSchemaQuery,
  useGetSchemaDataQuery,
  useDeleteRecordMutation,
  PipelineDataRecord,
} from '@/services/pipelineSchemasApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';
import { FileUploadZone } from '@/components/uploads/FileUploadZone';

/**
 * UploadDetailPage - Shows uploaded files for a specific upload schema.
 * Route: /repo/:owner/:repo/uploads/:schemaId
 */
export function UploadDetailPage() {
  const { owner, repo, schemaId } = useParams<{
    owner: string;
    repo: string;
    schemaId: string;
  }>();
  const { toast } = useToast();
  const { canEdit } = useProjectRole(owner!, repo!);
  const [page, setPage] = useState(1);
  const [deletingRecord, setDeletingRecord] = useState<PipelineDataRecord | null>(null);
  const pageSize = 20;

  // Fetch schema details
  const { data: schema, isLoading: isLoadingSchema } = useGetSchemaQuery(schemaId!, {
    skip: !schemaId,
  });

  // Fetch uploaded files (pipeline data records)
  const {
    data: filesData,
    isLoading: isLoadingFiles,
    refetch: refetchFiles,
  } = useGetSchemaDataQuery(
    { schemaId: schemaId!, page, pageSize },
    { skip: !schemaId },
  );

  const [deleteRecord, { isLoading: isDeleting }] = useDeleteRecordMutation();

  const handleDelete = async () => {
    if (!deletingRecord || !schemaId) return;
    try {
      await deleteRecord({ schemaId, recordId: deletingRecord.id }).unwrap();
      toast({
        title: 'File deleted',
        description: `File record has been deleted.`,
      });
      setDeletingRecord(null);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete file';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: 'Copied', description: 'URL copied to clipboard' });
  };

  const isLoading = isLoadingSchema || isLoadingFiles;
  const files = filesData?.records || [];
  const totalPages = filesData?.totalPages || 1;

  // Determine upload URL from schema's sub_dir field
  // We look at the first record's sub_dir, or fallback to the schema name
  const subDir =
    files.length > 0
      ? (files[0].data?.sub_dir as string)
      : schema?.name || '';
  const uploadUrl = subDir ? `/public/${owner}/${repo}/alias/production/api/uploads/${subDir}` : '';

  const formatFileSize = (bytes: unknown): string => {
    const size = Number(bytes);
    if (isNaN(size)) return '—';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageType = (contentType: unknown): boolean => {
    return typeof contentType === 'string' && contentType.startsWith('image/');
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={`/repo/${owner}/${repo}/uploads`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Uploads
        </Link>

        {/* Upload zone */}
        {canEdit && uploadUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upload Files</CardTitle>
              <CardDescription>
                Upload files to {schema?.name || 'this schema'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploadZone
                uploadUrl={uploadUrl}
                onUploadComplete={() => refetchFiles()}
              />
            </CardContent>
          </Card>
        )}

        {/* Files table */}
        <Card>
          <CardHeader>
            <CardTitle>{schema?.name || 'Upload Schema'}</CardTitle>
            <CardDescription>
              {filesData?.total || 0} uploaded file{(filesData?.total || 0) !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="p-8 text-center">
                <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No files uploaded yet</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Preview</TableHead>
                      <TableHead>Filename</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>URL</TableHead>
                      {canEdit && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((record) => {
                      const data = record.data || {};
                      return (
                        <TableRow key={record.id}>
                          <TableCell className="w-16">
                            {isImageType(data.content_type) && data.url ? (
                              <img
                                src={`/public/${owner}/${repo}/alias/production${data.url}`}
                                alt={String(data.filename || '')}
                                className="h-10 w-10 object-cover rounded"
                              />
                            ) : (
                              <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                                <Image className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {String(data.original_name || data.filename || '—')}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {String(data.content_type || '—')}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatFileSize(data.size)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(record.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {typeof data.url === 'string' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleCopyUrl(data.url as string)}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeletingRecord(record)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingRecord}
        onOpenChange={(open) => !open && setDeletingRecord(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this file record? The file in storage will not be
              automatically removed. This action cannot be undone.
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
