import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
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
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Trash2, Copy, Download, ChevronLeft, ChevronRight, Image, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  useGetSchemaQuery,
  useGetSchemaDataQuery,
  useDeleteRecordMutation,
  PipelineDataRecord,
} from '@/services/pipelineSchemasApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useToast } from '@/hooks/use-toast';

function getPreviewUrl(storagePath: string): string {
  return `/api/pipeline-schemas/storage/preview?path=${encodeURIComponent(storagePath)}`;
}

/**
 * Every record written by an upload handler carries `storage_path` — it is what
 * makes a record an uploaded file rather than an arbitrary row. A schema is free
 * to hold both (an app modelling a file tree stores its folders as rows in the
 * same schema), so this view lists only the rows that reference stored bytes;
 * the rest are shown as a count with a pointer to the Data tab.
 */
const FILE_MARKER_FIELD = 'storage_path';

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
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pageSize = 20;

  // Debounce search input
  const searchTimeoutRef = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef[0]) clearTimeout(searchTimeoutRef[0]);
    searchTimeoutRef[0] = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  };

  // Fetch schema details
  const { data: schema, isLoading: isLoadingSchema } = useGetSchemaQuery(schemaId!, {
    skip: !schemaId,
  });

  useDocumentTitle(schema ? [schema.name, 'Uploads', `${owner}/${repo}`] : null);

  // Only records that actually reference stored bytes belong in an uploads list.
  const hasFileMarker = schema?.fields?.some((f) => f.name === FILE_MARKER_FIELD) ?? false;

  // Fetch uploaded files (pipeline data records). Waits for the schema so the
  // file filter is known up front — otherwise the first render would briefly
  // list non-file records.
  const {
    data: filesData,
    isLoading: isLoadingFiles,
  } = useGetSchemaDataQuery(
    {
      schemaId: schemaId!,
      page,
      pageSize,
      search: debouncedSearch || undefined,
      createdAfter: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      createdBefore: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      filters: hasFileMarker
        ? { [FILE_MARKER_FIELD]: { op: 'exists' as const, value: 'true' } }
        : undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    },
    { skip: !schemaId || !schema },
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

  const handleDownload = (storagePath: string, filename: string) => {
    const url = getPreviewUrl(storagePath);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isLoading = isLoadingSchema || isLoadingFiles;
  const files = filesData?.records || [];
  const totalPages = filesData?.totalPages || 1;

  // Records held back by the file filter. Only meaningful against an unfiltered
  // list — schema.recordCount is the whole schema, so a search or date range
  // would make the subtraction lie.
  const isUnfiltered = !debouncedSearch && !dateFrom && !dateTo;
  const nonFileCount =
    hasFileMarker && isUnfiltered && schema && filesData
      ? Math.max(0, schema.recordCount - filesData.total)
      : 0;

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

        {/* Files table */}
        <Card>
          <CardHeader>
            <CardTitle>{schema?.name || 'Upload Schema'}</CardTitle>
            <CardDescription>
              {filesData?.total || 0} uploaded file{(filesData?.total || 0) !== 1 ? 's' : ''}
              {nonFileCount > 0 && (
                <>
                  {' · '}
                  {nonFileCount} record{nonFileCount !== 1 ? 's' : ''} without a file (not shown){' '}
                  <Link
                    to={`/repo/${owner}/${repo}/data/${schemaId}`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    view in Data
                  </Link>
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Search & Date Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search by filename..."
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="w-[150px] text-sm"
                  title="From date"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="w-[150px] text-sm"
                  title="To date"
                />
                {(dateFrom || dateTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                    className="text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

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
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((record) => {
                      const data = record.data || {};
                      const storagePath = typeof data.storage_path === 'string' ? data.storage_path : '';
                      const filename = String(data.original_name || data.filename || 'file');
                      const isImage = isImageType(data.content_type);

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="w-16">
                            {isImage && storagePath ? (
                              <img
                                src={getPreviewUrl(storagePath)}
                                alt={String(data.filename || '')}
                                className="h-10 w-10 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() =>
                                  setPreviewImage({
                                    src: getPreviewUrl(storagePath),
                                    alt: filename,
                                  })
                                }
                              />
                            ) : (
                              <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                                <Image className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate">
                            {filename}
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
                            <div className="flex items-center gap-1">
                              {typeof data.url === 'string' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Copy URL"
                                  onClick={() => handleCopyUrl(data.url as string)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {storagePath && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Download"
                                  onClick={() => handleDownload(storagePath, filename)}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  title="Delete"
                                  onClick={() => setDeletingRecord(record)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
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

      {/* Image Preview Lightbox */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-2">
          {previewImage && (
            <img
              src={previewImage.src}
              alt={previewImage.alt}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>

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
