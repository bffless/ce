import { Injectable, Logger } from '@nestjs/common';
import {
  IStorageAdapter,
  FileMetadata,
  DownloadResult,
  DownloadStreamOptions,
  StreamDownloadResult,
  SignedUrlOptions,
} from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';
import { tryResolvePublicOrigin } from './presign.util';

/**
 * Dynamic Storage Adapter
 *
 * A proxy adapter that delegates to an internal adapter.
 * Allows the actual storage adapter to be swapped at runtime
 * (e.g., after setup wizard completes).
 *
 * This solves the problem of NestJS modules being initialized once at startup,
 * before the user has completed the setup wizard.
 */
@Injectable()
export class DynamicStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(DynamicStorageAdapter.name);
  private adapter: IStorageAdapter;
  private readonly instanceId: string;

  constructor() {
    // Generate a unique instance ID to track this singleton
    this.instanceId = Math.random().toString(36).substring(7);
    // Start with a default local adapter
    this.adapter = new LocalStorageAdapter({
      localPath: './uploads',
      publicOrigin: tryResolvePublicOrigin(),
    });
    this.logger.log(
      `DynamicStorageAdapter [${this.instanceId}] initialized with default LocalStorageAdapter`,
    );
  }

  /**
   * Get the unique instance ID (for debugging singleton issues)
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Swap the internal storage adapter
   * Called after setup wizard completes to switch to the configured adapter
   */
  setAdapter(adapter: IStorageAdapter): void {
    const oldAdapter = this.adapter.constructor.name;
    this.adapter = adapter;
    this.logger.log(
      `DynamicStorageAdapter [${this.instanceId}] swapped from ${oldAdapter} to ${adapter.constructor.name}`,
    );
  }

  /**
   * Get the current adapter type (for debugging/logging)
   */
  getAdapterType(): string {
    return this.adapter.constructor.name;
  }

  /**
   * Get the underlying adapter instance
   * Used for unwrapping/rewrapping with caching layer
   */
  getUnderlyingAdapter(): IStorageAdapter {
    return this.adapter;
  }

  // Delegate all IStorageAdapter methods to the internal adapter

  async upload(file: Buffer, key: string, metadata?: Record<string, any>): Promise<string> {
    this.logger.debug(
      `DynamicStorageAdapter [${this.instanceId}] upload using ${this.adapter.constructor.name}`,
    );
    return this.adapter.upload(file, key, metadata);
  }

  async download(key: string): Promise<Buffer> {
    return this.adapter.download(key);
  }

  async downloadWithCacheInfo(key: string): Promise<DownloadResult> {
    // Delegate to underlying adapter if it supports cache info
    if (this.adapter.downloadWithCacheInfo) {
      return this.adapter.downloadWithCacheInfo(key);
    }
    // Fallback: no caching layer, return 'none'
    const data = await this.adapter.download(key);
    return { data, cacheHit: 'none' };
  }

  /**
   * Stream a file from the active adapter without buffering it into memory.
   *
   * Exposed as a getter so capability detection by property presence keeps
   * working: callers (e.g. FileServeHandler) check `if (storageAdapter.downloadStream)`
   * to choose between streaming and the buffer-everything fallback. Because the
   * real adapter is swapped in at runtime (after the setup wizard), a plain
   * delegating method would always be present and defeat that check — making the
   * handler stream even for backends that can't, or, as happened here, this proxy
   * lacking the method entirely forced every serve down the buffer path (OOM on
   * large files). The getter returns a delegating function only when the active
   * adapter actually supports streaming, and undefined otherwise.
   */
  get downloadStream():
    | ((key: string, opts?: DownloadStreamOptions) => Promise<StreamDownloadResult>)
    | undefined {
    return this.adapter.downloadStream
      ? (key: string, opts?: DownloadStreamOptions) => this.adapter.downloadStream!(key, opts)
      : undefined;
  }

  async delete(key: string): Promise<void> {
    return this.adapter.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(key);
  }

  async getUrl(
    key: string,
    expiresIn?: number,
    options?: SignedUrlOptions,
  ): Promise<string> {
    return this.adapter.getUrl(key, expiresIn, options);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    return this.adapter.listKeys(prefix);
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    return this.adapter.getMetadata(key);
  }

  async testConnection(): Promise<boolean> {
    return this.adapter.testConnection();
  }

  async deletePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    return this.adapter.deletePrefix(prefix);
  }

  supportsPresignedUrls(): boolean {
    return this.adapter.supportsPresignedUrls?.() ?? false;
  }

  async getPresignedUploadUrl(key: string, expiresIn?: number): Promise<string> {
    if (!this.adapter.getPresignedUploadUrl) {
      throw new Error('Presigned URLs not supported by current storage adapter');
    }
    return this.adapter.getPresignedUploadUrl(key, expiresIn);
  }
}
