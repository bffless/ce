import type {
  FinalizeDeploymentUploadResponse,
  PrepareDeploymentUploadFile,
  PrepareDeploymentUploadResponse,
} from './repoApi';

export interface FileProgress {
  path: string;
  loaded: number;
  total: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export interface UploadDeploymentArgs {
  files: File[];
  paths: string[];
  repository: string;
  commitSha: string;
  branch?: string;
  description?: string;
  basePath?: string;
  source?: 'github' | 'manual';
  onProgress?: (progress: FileProgress[]) => void;
  signal?: AbortSignal;
}

const PARALLEL_UPLOADS = 6;
const PUT_RETRY_ATTEMPTS = 1;

export async function uploadDeployment(
  args: UploadDeploymentArgs,
): Promise<FinalizeDeploymentUploadResponse> {
  if (args.files.length !== args.paths.length) {
    throw new Error('files and paths arrays must be the same length');
  }
  if (args.files.length === 0) {
    throw new Error('At least one file is required');
  }

  const manifest: PrepareDeploymentUploadFile[] = args.files.map((file, i) => ({
    path: args.paths[i],
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  }));

  const prepareResponse = await postJson<PrepareDeploymentUploadResponse>(
    '/api/deployments/prepare-batch-upload',
    {
      repository: args.repository,
      commitSha: args.commitSha,
      branch: args.branch,
      description: args.description,
      basePath: args.basePath,
      source: args.source ?? 'manual',
      files: manifest,
    },
    args.signal,
  );

  if (prepareResponse.presignedUrlsSupported) {
    if (!prepareResponse.uploadToken || !prepareResponse.files) {
      throw new Error('Invalid response from prepare-batch-upload');
    }
    await uploadWithPresignedUrls({
      files: args.files,
      paths: args.paths,
      presignedFiles: prepareResponse.files,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    return postJson<FinalizeDeploymentUploadResponse>(
      '/api/deployments/finalize-upload',
      { uploadToken: prepareResponse.uploadToken },
      args.signal,
    );
  }

  return uploadWithZipFallback(args);
}

interface PresignedUploadArgs {
  files: File[];
  paths: string[];
  presignedFiles: NonNullable<PrepareDeploymentUploadResponse['files']>;
  onProgress?: (progress: FileProgress[]) => void;
  signal?: AbortSignal;
}

async function uploadWithPresignedUrls(args: PresignedUploadArgs): Promise<void> {
  const urlByPath = new Map(args.presignedFiles.map((f) => [f.path, f.presignedUrl]));

  const progress: FileProgress[] = args.files.map((file, i) => ({
    path: args.paths[i],
    loaded: 0,
    total: file.size,
    status: 'pending',
  }));
  const emit = () => args.onProgress?.(progress.slice());
  emit();

  let nextIndex = 0;
  const failures: { path: string; error: string }[] = [];

  const worker = async () => {
    while (true) {
      if (args.signal?.aborted) throw new Error('Upload aborted');
      const i = nextIndex++;
      if (i >= args.files.length) return;
      const file = args.files[i];
      const path = args.paths[i];
      const presignedUrl = urlByPath.get(path);
      if (!presignedUrl) {
        progress[i] = { ...progress[i], status: 'error', error: 'No presigned URL' };
        failures.push({ path, error: 'No presigned URL' });
        emit();
        continue;
      }
      try {
        await putFileWithRetry(file, presignedUrl, (loaded) => {
          progress[i] = { ...progress[i], loaded, status: 'uploading' };
          emit();
        }, args.signal);
        progress[i] = { ...progress[i], loaded: file.size, status: 'done' };
        emit();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress[i] = { ...progress[i], status: 'error', error: message };
        failures.push({ path, error: message });
        emit();
      }
    }
  };

  const workers = Array.from({ length: Math.min(PARALLEL_UPLOADS, args.files.length) }, worker);
  await Promise.all(workers);

  if (failures.length > 0) {
    const sample = failures.slice(0, 3).map((f) => `${f.path}: ${f.error}`).join('; ');
    throw new Error(
      `${failures.length} of ${args.files.length} file uploads failed (${sample})`,
    );
  }
}

async function putFileWithRetry(
  file: File,
  url: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= PUT_RETRY_ATTEMPTS) {
    try {
      await putFile(file, url, onProgress, signal);
      return;
    } catch (err) {
      lastError = err;
      attempt++;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isAzureBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes('.blob.core.');
  } catch {
    return false;
  }
}

function putFile(
  file: File,
  url: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    if (isAzureBlobUrl(url)) xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`PUT failed (${xhr.status}): ${xhr.statusText || xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new Error('Upload aborted'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

async function uploadWithZipFallback(
  args: UploadDeploymentArgs,
): Promise<FinalizeDeploymentUploadResponse> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  args.files.forEach((file, i) => {
    zip.file(args.paths[i], file);
  });

  // Aggregate progress: report combined "loaded" against total size for the single ZIP PUT.
  const totalSize = args.files.reduce((sum, f) => sum + f.size, 0);
  const reportAggregate = (loaded: number) => {
    if (!args.onProgress) return;
    args.onProgress(
      args.files.map((file, i) => ({
        path: args.paths[i],
        loaded: Math.min(file.size, Math.max(0, loaded - sumBefore(args.files, i))),
        total: file.size,
        status: loaded >= totalSize ? 'done' : 'uploading',
      })),
    );
  };

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  const formData = new FormData();
  formData.append('file', zipBlob, 'deployment.zip');
  formData.append('repository', args.repository);
  formData.append('commitSha', args.commitSha);
  if (args.branch) formData.append('branch', args.branch);
  if (args.description) formData.append('description', args.description);
  if (args.basePath) formData.append('basePath', args.basePath);
  formData.append('source', args.source ?? 'manual');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/deployments/zip', true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) reportAggregate(e.loaded * (totalSize / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`ZIP upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during ZIP upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    if (args.signal) {
      if (args.signal.aborted) {
        xhr.abort();
        reject(new Error('Upload aborted'));
        return;
      }
      args.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

function sumBefore(files: File[], index: number): number {
  let s = 0;
  for (let i = 0; i < index; i++) s += files[i].size;
  return s;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.error?.message || text;
    } catch {
      // Not JSON, fall back to raw text
    }
    throw new Error(`${url} failed (${response.status}): ${message}`);
  }
  return response.json();
}
