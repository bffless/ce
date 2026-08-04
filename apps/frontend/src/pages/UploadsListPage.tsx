import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, Zap, FileImage, ArrowRight } from 'lucide-react';
import {
  useGetProjectSchemasQuery,
  useGetSchemaDataQuery,
  PipelineSchemaWithCount,
} from '@/services/pipelineSchemasApi';
import { useGetProjectQuery } from '@/services/projectsApi';
import { useProjectRole } from '@/hooks/useProjectRole';
import { GenerateUploadModal } from '@/components/uploads/GenerateUploadModal';

/**
 * Heuristic: a schema is "likely" an upload schema if it has these fields.
 * Used only for sorting — generated upload schemas appear first in the list.
 */
function looksLikeUploadSchema(schema: PipelineSchemaWithCount): boolean {
  const fieldNames = new Set(schema.fields.map((f) => f.name));
  return fieldNames.has('storage_path') && fieldNames.has('content_type') && fieldNames.has('url');
}

/**
 * UploadsListPage - Content for the Uploads tab.
 * Shows all schemas and lets the user pick any as an upload target.
 * Schemas generated via "Generate Upload Schema" appear first.
 * Route: /repo/:owner/:repo/uploads
 */
export function UploadsListPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const { canEdit } = useProjectRole(owner!, repo!);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>('');

  // Fetch project to get projectId
  const { data: project, isLoading: isLoadingProject } = useGetProjectQuery(
    { owner: owner!, name: repo! },
    { skip: !owner || !repo },
  );

  // Fetch all schemas for this project
  const {
    data: schemasData,
    isLoading: isLoadingSchemas,
    error: schemasError,
  } = useGetProjectSchemasQuery(project?.id || '', {
    skip: !project?.id,
  });

  const isLoading = isLoadingProject || isLoadingSchemas;
  const allSchemas = schemasData?.schemas || [];

  // Sort: upload-like schemas first, then alphabetical
  const sortedSchemas = [...allSchemas].sort((a, b) => {
    const aUpload = looksLikeUploadSchema(a);
    const bUpload = looksLikeUploadSchema(b);
    if (aUpload && !bUpload) return -1;
    if (!aUpload && bUpload) return 1;
    return a.name.localeCompare(b.name);
  });

  const uploadLikeSchemas = sortedSchemas.filter(looksLikeUploadSchema);
  const otherSchemas = sortedSchemas.filter((s) => !looksLikeUploadSchema(s));

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Uploads</CardTitle>
          <CardDescription>Manage file uploads and uploaded files</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-48" />
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
          <CardTitle>Uploads</CardTitle>
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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Uploads</CardTitle>
            <CardDescription>Manage file uploads and uploaded files</CardDescription>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setShowGenerateModal(true)}
            >
              <Zap className="h-4 w-4" />
              Generate Upload Schema
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {allSchemas.length === 0 ? (
            <div className="p-8 text-center">
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium">No schemas found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {canEdit
                  ? 'Generate an upload schema to start uploading files'
                  : 'No schemas have been created for this repository yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Upload schemas section */}
              {uploadLikeSchemas.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Upload Schemas</h3>
                  {uploadLikeSchemas.map((schema) => (
                    <SchemaCard
                      key={schema.id}
                      schema={schema}
                      onClick={() => navigate(`/repo/${owner}/${repo}/uploads/${schema.id}`)}
                    />
                  ))}
                </div>
              )}

              {/* Browse any schema */}
              {otherSchemas.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {uploadLikeSchemas.length > 0 ? 'Other Schemas' : 'All Schemas'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Select value={selectedSchemaId} onValueChange={setSelectedSchemaId}>
                      <SelectTrigger className="w-full min-w-0 flex-1">
                        <SelectValue placeholder="Select a schema to browse uploads..." />
                      </SelectTrigger>
                      <SelectContent>
                        {otherSchemas.map((schema) => (
                          <SelectItem key={schema.id} value={schema.id}>
                            {schema.name} ({schema.recordCount} record{schema.recordCount !== 1 ? 's' : ''})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      className="shrink-0"
                      disabled={!selectedSchemaId}
                      onClick={() => {
                        if (selectedSchemaId) {
                          navigate(`/repo/${owner}/${repo}/uploads/${selectedSchemaId}`);
                        }
                      }}
                    >
                      View
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate Upload Schema Modal */}
      {canEdit && project && (
        <GenerateUploadModal
          open={showGenerateModal}
          onOpenChange={setShowGenerateModal}
          projectId={project.id}
        />
      )}
    </>
  );
}

function SchemaCard({
  schema,
  onClick,
}: {
  schema: PipelineSchemaWithCount;
  onClick: () => void;
}) {
  // `recordCount` counts every row in the schema, so for a schema that also
  // holds non-file rows it overstates the uploads (a file tree stored as one
  // schema counts its folders). Ask for the same file-only total the detail
  // view shows, so the two pages can't disagree; pageSize 1 because only the
  // total is wanted.
  const { data: fileData } = useGetSchemaDataQuery({
    schemaId: schema.id,
    page: 1,
    pageSize: 1,
    filters: { storage_path: { op: 'exists', value: 'true' } },
  });

  const fileCount = fileData?.total;
  const nonFileCount = fileCount === undefined ? 0 : Math.max(0, schema.recordCount - fileCount);

  return (
    <Card
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <FileImage className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h3 className="font-medium">{schema.name}</h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {fileCount === undefined ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <span>
                    {fileCount} file{fileCount !== 1 ? 's' : ''}
                    {nonFileCount > 0 && ` · ${nonFileCount} non-file record${nonFileCount !== 1 ? 's' : ''}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
