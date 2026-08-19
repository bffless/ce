import { useState, useCallback, useRef } from 'react';
import { Upload, X, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface FileUploadZoneProps {
  uploadUrl: string;
  onUploadComplete?: () => void;
  disabled?: boolean;
}

interface UploadState {
  file: File;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
}

export function FileUploadZone({ uploadUrl, onUploadComplete, disabled }: FileUploadZoneProps) {
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      for (const file of fileArray) {
        const uploadState: UploadState = { file, status: 'uploading' };
        setUploads((prev) => [...prev, uploadState]);

        try {
          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData,
            credentials: 'include',
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Upload failed (${response.status})`);
          }

          setUploads((prev) =>
            prev.map((u) => (u.file === file ? { ...u, status: 'complete' } : u)),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          setUploads((prev) =>
            prev.map((u) => (u.file === file ? { ...u, status: 'error', error: message } : u)),
          );
          toast({
            title: 'Upload Failed',
            description: `${file.name}: ${message}`,
            variant: 'destructive',
          });
        }
      }

      onUploadComplete?.();
    },
    [uploadUrl, onUploadComplete, toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!disabled) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [disabled, handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeUpload = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium">
          {isDragOver ? 'Drop files here' : 'Drag and drop files here, or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Files will be uploaded to storage</p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
          disabled={disabled}
        />
      </div>

      {/* Upload progress list */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload, index) => (
            <div
              key={`${upload.file.name}-${index}`}
              className="flex items-center gap-3 p-2 rounded-md bg-muted/50 text-sm"
            >
              {upload.status === 'uploading' && (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              )}
              {upload.status === 'complete' && (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              )}
              {upload.status === 'error' && <X className="h-4 w-4 text-destructive shrink-0" />}
              <span className="flex-1 truncate">{upload.file.name}</span>
              <span className="text-muted-foreground shrink-0">
                {formatFileSize(upload.file.size)}
              </span>
              {upload.status !== 'uploading' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeUpload(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
