import { Injectable, Logger } from '@nestjs/common';
import { IStorageAdapter, FileMetadata, DownloadResult } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';

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
    this.adapter = new LocalStorageAdapter({ localPath: './uploads' });
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

  async delete(key: string): Promise<void> {
    return this.adapter.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(key);
  }

  async getUrl(key: string, expiresIn?: number): Promise<string> {
    return this.adapter.getUrl(key, expiresIn);
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
}
