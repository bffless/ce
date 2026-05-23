import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/services/api';
import { useAppDispatch } from '@/store/hooks';
import { uploadDeployment, type FileProgress } from '@/services/uploadDeployment';
import type { BranchRef } from '@/services/repoApi';
import {
  CheckCircle2,
  FileIcon,
  FolderOpen,
  Loader2,
  Plus,
  Upload,
  X,
} from 'lucide-react';

interface CreateDeploymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  branches: BranchRef[];
}

interface SelectedFile {
  file: File;
  path: string;
}

const NEW_BRANCH_VALUE = '__new_branch__';
const SHA_PATTERN = /^[a-f0-9]{7,40}$/i;

function generateRandomSha(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Find the longest common directory prefix across all paths so the served
// site mounts at "/" instead of "/<picked-folder>/". Returns "" when there
// is no shared parent (single loose file, mixed roots, etc.).
function detectCommonBasePath(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/'));
  // Need at least one path with a directory segment to have a common parent.
  if (!split.some((parts) => parts.length > 1)) return '';
  const first = split[0];
  const common: string[] = [];
  for (let i = 0; i < first.length - 1; i++) {
    const segment = first[i];
    if (split.every((parts) => parts.length > i + 1 && parts[i] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }
  return common.join('/');
}

function normalizeBasePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

export function CreateDeploymentDialog({
  open,
  onOpenChange,
  owner,
  repo,
  branches,
}: CreateDeploymentDialogProps) {
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const defaultBranch = branches[0]?.name ?? 'main';
  const [autoSha] = useState(() => generateRandomSha());

  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [branchSelection, setBranchSelection] = useState(defaultBranch);
  const [newBranchName, setNewBranchName] = useState('');
  const [description, setDescription] = useState('');
  const [shaOverride, setShaOverride] = useState('');
  const [basePathOverride, setBasePathOverride] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.file.size, 0), [files]);
  const detectedBasePath = useMemo(
    () => detectCommonBasePath(files.map((f) => f.path)),
    [files],
  );
  const effectiveBasePath = basePathOverride ?? detectedBasePath;

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return { file, path: relativePath && relativePath.length > 0 ? relativePath : file.name };
    });

    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      const merged = [...prev];
      for (const candidate of incoming) {
        if (!seen.has(candidate.path)) {
          merged.push(candidate);
          seen.add(candidate.path);
        }
      }
      return merged;
    });
  }, []);

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const reset = () => {
    setFiles([]);
    setProgress([]);
    setBranchSelection(defaultBranch);
    setNewBranchName('');
    setDescription('');
    setShaOverride('');
    setBasePathOverride(null);
    setShowAdvanced(false);
    setError(null);
    setIsUploading(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (isUploading) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const aggregate = useMemo(() => {
    if (progress.length === 0) return { loaded: 0, total: totalSize, done: 0 };
    let loaded = 0;
    let total = 0;
    let done = 0;
    for (const p of progress) {
      loaded += p.loaded;
      total += p.total;
      if (p.status === 'done') done++;
    }
    return { loaded, total, done };
  }, [progress, totalSize]);

  const handleSubmit = async () => {
    setError(null);

    if (files.length === 0) {
      setError('Add at least one file before uploading');
      return;
    }

    let branch = branchSelection;
    if (branchSelection === NEW_BRANCH_VALUE) {
      const trimmed = newBranchName.trim();
      if (!trimmed) {
        setError('Enter a branch name');
        return;
      }
      branch = trimmed;
    }

    let commitSha = autoSha;
    if (shaOverride.trim()) {
      const candidate = shaOverride.trim().toLowerCase();
      if (!SHA_PATTERN.test(candidate)) {
        setError('SHA must be 7–40 hexadecimal characters');
        return;
      }
      commitSha = candidate;
    }

    setIsUploading(true);
    setProgress(
      files.map(({ file, path }) => ({
        path,
        loaded: 0,
        total: file.size,
        status: 'pending',
      })),
    );

    try {
      const normalizedBasePath = normalizeBasePath(effectiveBasePath);

      const result = await uploadDeployment({
        files: files.map((f) => f.file),
        paths: files.map((f) => f.path),
        repository: `${owner}/${repo}`,
        commitSha,
        branch,
        description: description.trim() || undefined,
        basePath: normalizedBasePath !== '/' ? normalizedBasePath : undefined,
        source: 'manual',
        onProgress: (next) => setProgress(next),
      });

      // Invalidate cache tags so DeploymentsList + refs + stats refetch.
      dispatch(
        api.util.invalidateTags([
          { type: 'Asset', id: `${owner}/${repo}/deployments` },
          { type: 'Asset', id: `${owner}/${repo}/refs` },
          { type: 'Asset', id: `${owner}/${repo}/stats` },
        ]),
      );

      toast({
        title: 'Deployment created',
        description: `${result.fileCount} files uploaded (${formatBytes(result.totalSize)})`,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Deployment</DialogTitle>
          <DialogDescription>
            Upload files directly from your computer. The browser uploads files to storage and
            registers them as a deployment for {owner}/{repo}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">{error}</div>
          )}

          {/* Drop zone */}
          {!isUploading && (
            <div
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Drop files here, or use the buttons below</p>
              <p className="text-xs text-muted-foreground mt-1">
                Folder structure is preserved when picking a folder
              </p>
              <div className="flex justify-center gap-2 mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileIcon className="h-4 w-4 mr-2" />
                  Add files
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Add folder
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                // @ts-expect-error -- non-standard attribute, supported in Chromium/WebKit
                webkitdirectory=""
                directory=""
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {/* File list / progress */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {files.length} file{files.length !== 1 ? 's' : ''} • {formatBytes(totalSize)}
                </span>
                {!isUploading && (
                  <Button variant="ghost" size="sm" onClick={() => setFiles([])}>
                    Clear
                  </Button>
                )}
              </div>

              {isUploading && (
                <div className="space-y-1">
                  <Progress
                    value={
                      aggregate.total > 0 ? (aggregate.loaded / aggregate.total) * 100 : 0
                    }
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {aggregate.done}/{files.length} files
                    </span>
                    <span>
                      {formatBytes(aggregate.loaded)} / {formatBytes(aggregate.total)}
                    </span>
                  </div>
                </div>
              )}

              <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                {(isUploading ? progress : files.map((f) => ({
                  path: f.path,
                  loaded: 0,
                  total: f.file.size,
                  status: 'pending' as const,
                }))).map((p) => (
                  <div key={p.path} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    {isUploading ? (
                      p.status === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      ) : p.status === 'error' ? (
                        <X className="h-4 w-4 text-destructive shrink-0" />
                      ) : p.status === 'uploading' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      ) : (
                        <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      )
                    ) : (
                      <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 truncate" title={p.path}>
                      {p.path}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatBytes(p.total)}
                    </span>
                    {!isUploading && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => removeFile(p.path)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch + description (hidden during upload to declutter) */}
          {!isUploading && (
            <>
              <div>
                <Label htmlFor="deploy-branch">Branch</Label>
                <Select value={branchSelection} onValueChange={setBranchSelection}>
                  <SelectTrigger id="deploy-branch" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_BRANCH_VALUE}>+ New branch…</SelectItem>
                  </SelectContent>
                </Select>
                {branchSelection === NEW_BRANCH_VALUE && (
                  <Input
                    autoFocus
                    placeholder="branch-name"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              <div>
                <Label htmlFor="deploy-description">Description (optional)</Label>
                <Input
                  id="deploy-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's in this deployment?"
                  className="mt-1"
                />
              </div>

              <div>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? '▾' : '▸'} Advanced
                </button>
                {showAdvanced && (
                  <div className="mt-2 space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="deploy-sha" className="text-xs">
                        Commit SHA override
                      </Label>
                      <Input
                        id="deploy-sha"
                        value={shaOverride}
                        onChange={(e) => setShaOverride(e.target.value)}
                        placeholder={autoSha}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        7–40 hex characters. Leave blank to use the auto-generated SHA.
                      </p>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="deploy-base-path" className="text-xs">
                        Base path
                      </Label>
                      <Input
                        id="deploy-base-path"
                        value={effectiveBasePath}
                        onChange={(e) => setBasePathOverride(e.target.value)}
                        placeholder="/"
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        {detectedBasePath
                          ? `Stripped from URLs so the site serves at the root. Auto-detected from your files: "${detectedBasePath}". Clear to serve everything as-is.`
                          : 'Stripped from URLs when serving. Leave as "/" for site-root deployments.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isUploading || files.length === 0}
              className="gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading {aggregate.done}/{files.length}…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Deployment
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
