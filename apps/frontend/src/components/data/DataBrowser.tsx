import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Trash2, ChevronDown, ChevronRight, ChevronLeft, Database, Plus, Pencil } from 'lucide-react';
import {
  useGetSchemaDataQuery,
  useDeleteRecordMutation,
  useDeleteRecordsMutation,
  SchemaField,
  PipelineDataRecord,
} from '@/services/pipelineSchemasApi';
import { useToast } from '@/hooks/use-toast';
import { RecordEditorDialog } from './RecordEditorDialog';

interface DataBrowserProps {
  schemaId: string;
  fields: SchemaField[];
  canEdit: boolean;
}

export function DataBrowser({ schemaId, fields, canEdit }: DataBrowserProps) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; ids: string[] } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PipelineDataRecord | null>(null);

  const pageSize = 20;

  // Fetch data
  const { data, isLoading, error, refetch } = useGetSchemaDataQuery(
    { schemaId, page, pageSize },
    { skip: !schemaId },
  );

  // Mutations
  const [deleteRecord, { isLoading: isDeletingSingle }] = useDeleteRecordMutation();
  const [deleteRecords, { isLoading: isDeletingBulk }] = useDeleteRecordsMutation();

  const isDeleting = isDeletingSingle || isDeletingBulk;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(data?.records.map((r) => r.id) || []));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === 'single') {
        await deleteRecord({ schemaId, recordId: deleteConfirm.ids[0] }).unwrap();
        toast({
          title: 'Record deleted',
          description: 'The record has been deleted.',
        });
      } else {
        const result = await deleteRecords({ schemaId, ids: deleteConfirm.ids }).unwrap();
        toast({
          title: 'Records deleted',
          description: `${result.deleted} record${result.deleted === 1 ? '' : 's'} deleted.`,
        });
        setSelectedIds(new Set());
      }
      setDeleteConfirm(null);
      refetch();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Failed to delete record(s)';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleAddRecord = () => {
    setEditingRecord(null);
    setEditorOpen(true);
  };

  const handleEditRecord = (record: PipelineDataRecord) => {
    setEditingRecord(record);
    setEditorOpen(true);
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Records</CardTitle>
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

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Records</CardTitle>
        </CardHeader>
        <CardContent className="p-8 text-center">
          <p className="text-destructive">Failed to load data</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const records = data?.records || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const allSelected = records.length > 0 && selectedIds.size === records.length;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Data Records</CardTitle>
            <CardDescription>
              {total} total record{total === 1 ? '' : 's'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setDeleteConfirm({ type: 'bulk', ids: Array.from(selectedIds) })}
              >
                <Trash2 className="h-4 w-4" />
                Delete {selectedIds.size} selected
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                className="gap-2"
                onClick={handleAddRecord}
              >
                <Plus className="h-4 w-4" />
                Add Record
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <div className="p-8 text-center">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium">No data records yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Records will appear here when pipeline handlers create them
              </p>
            </div>
          ) : (
            <>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canEdit && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={handleSelectAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                      )}
                      <TableHead className="w-12"></TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Data Preview</TableHead>
                      <TableHead>Created</TableHead>
                      {canEdit && <TableHead className="w-12"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <>
                        <TableRow key={record.id}>
                          {canEdit && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(record.id)}
                                onCheckedChange={(checked) =>
                                  handleSelectOne(record.id, !!checked)
                                }
                                aria-label={`Select record ${record.id}`}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => toggleExpand(record.id)}
                            >
                              {expandedId === record.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {record.id.slice(0, 8)}...
                          </TableCell>
                          <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                            {JSON.stringify(record.data).slice(0, 100)}
                            {JSON.stringify(record.data).length > 100 && '...'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(record.createdAt).toLocaleString()}
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleEditRecord(record)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    setDeleteConfirm({ type: 'single', ids: [record.id] })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {expandedId === record.id && (
                          <TableRow>
                            <TableCell
                              colSpan={canEdit ? 6 : 4}
                              className="bg-muted/30 p-4"
                            >
                              <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                                {JSON.stringify(record.data, null, 2)}
                              </pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Record{deleteConfirm?.ids.length === 1 ? '' : 's'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              {deleteConfirm?.ids.length === 1
                ? 'this record'
                : `${deleteConfirm?.ids.length} records`}
              ? This action cannot be undone.
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

      {/* Record Editor Dialog */}
      <RecordEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        schemaId={schemaId}
        fields={fields}
        record={editingRecord}
        onSuccess={() => refetch()}
      />
    </>
  );
}
