import {
  Controller,
  Put,
  Query,
  Req,
  Res,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { IStorageAdapter, STORAGE_ADAPTER } from './storage.interface';
import { verifyLocalUpload } from './presign.util';
import { LocalUploadWriterService, UploadTooLargeError } from './local-upload-writer.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { StorageQuotaService } from './storage-quota.service';

interface PresignQuery {
  key?: string;
  exp?: string;
  max?: string;
  sig?: string;
}

/**
 * Signature-authorized upload route for local filesystem storage.
 *
 * Deliberately has NO auth guard: authorization is the HMAC signature minted by
 * LocalStorageAdapter.getPresignedUploadUrl, exactly as an S3 presigned PUT
 * carries its own authorization. No cookie, session, or API key is consulted,
 * so the route cannot act as a confused deputy.
 */
@ApiTags('Storage')
@Controller('api/storage/presigned')
export class LocalPresignedUploadController {
  private readonly logger = new Logger(LocalPresignedUploadController.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly writer: LocalUploadWriterService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly quota: StorageQuotaService,
  ) {}

  @Put('local')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Upload bytes to local storage using a presigned URL' })
  @ApiResponse({ status: 200, description: 'Stored' })
  async upload(
    @Query() query: PresignQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // 1. Flag — 404 so the route's existence isn't advertised when disabled.
    if (!(await this.featureFlags.isEnabled('ENABLE_LOCAL_PRESIGNED_UPLOADS'))) {
      throw new NotFoundException();
    }

    // 2. Active adapter must be local. A URL minted before a backend swap must
    //    not write to disk on a bucket-backed install.
    const local = this.resolveLocalAdapter();
    if (!local) throw new NotFoundException();

    // 3. Params.
    const { key: encodedKey, exp: expRaw, max: maxRaw, sig } = query;
    if (!encodedKey || !expRaw || !maxRaw || !sig) {
      throw new BadRequestException('Missing presigned upload parameters');
    }
    const exp = Number(expRaw);
    const max = Number(maxRaw);
    if (!Number.isFinite(exp) || !Number.isFinite(max) || max <= 0) {
      throw new BadRequestException('Malformed presigned upload parameters');
    }

    let storageKey: string;
    try {
      storageKey = Buffer.from(encodedKey, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Malformed key parameter');
    }

    // 4. Signature.
    if (!verifyLocalUpload({ key: storageKey, exp, max }, sig, local.getPresignKey())) {
      this.logger.warn(`Rejected presigned upload with invalid signature for key: ${storageKey}`);
      throw new ForbiddenException('Invalid upload signature');
    }

    // 5. Expiry.
    if (exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('Upload URL has expired');
    }

    // 6/7. Declared size.
    const lengthHeader = req.headers['content-length'];
    if (lengthHeader === undefined) {
      throw new HttpException('Content-Length is required', HttpStatus.LENGTH_REQUIRED);
    }
    const contentLength = Number(lengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new BadRequestException('Malformed Content-Length');
    }
    if (contentLength > max) {
      throw new PayloadTooLargeException(`Upload exceeds the signed maximum of ${max} bytes`);
    }

    // 8. Quota, before any bytes land.
    // HttpStatus has no INSUFFICIENT_STORAGE member in the @nestjs/common
    // version pinned here (its enum stops at 505 HTTP_VERSION_NOT_SUPPORTED),
    // so 507 is passed as a literal.
    const quotaResult = await this.quota.checkQuota(contentLength);
    if (!quotaResult.allowed) {
      throw new HttpException(quotaResult.message || 'Storage quota exceeded', 507);
    }

    // 9. Key confinement — defence in depth; the signature already binds the key.
    if (storageKey !== this.normalizeKey(storageKey)) {
      throw new BadRequestException('Invalid storage key');
    }

    // Stream it.
    let result: { bytesWritten: number; etag: string };
    try {
      result = await this.writer.writeStream({
        source: req,
        basePath: local.getStorageBasePath(),
        storageKey,
        maxBytes: max,
      });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        throw new PayloadTooLargeException(err.message);
      }
      throw err;
    }

    await this.invalidateCache(storageKey);

    res.setHeader('ETag', `"${result.etag}"`);
    res.status(HttpStatus.OK);
  }

  /** Narrow the (possibly dynamic/cache-wrapped) adapter to a local one. */
  private resolveLocalAdapter(): {
    getStorageBasePath(): string;
    getPresignKey(): Buffer;
  } | null {
    const candidates: unknown[] = [this.storageAdapter];
    const adapter = this.storageAdapter as unknown as {
      getUnderlyingAdapter?: () => unknown;
      getWrappedAdapter?: () => unknown;
    };
    if (adapter.getUnderlyingAdapter) candidates.push(adapter.getUnderlyingAdapter());
    if (adapter.getWrappedAdapter) candidates.push(adapter.getWrappedAdapter());

    for (const candidate of candidates) {
      const c = candidate as any;
      if (c?.isLocalAdapter) return c;
      const inner = c?.getUnderlyingAdapter?.() ?? c?.getWrappedAdapter?.();
      if (inner?.isLocalAdapter) return inner;
    }
    return null;
  }

  /** Mirrors LocalStorageAdapter.sanitizeKey's normalization. */
  private normalizeKey(key: string): string {
    if (key.includes('..') || key.includes('\0')) return '';
    return key.replace(/^\/+|\/+$/g, '');
  }

  /** A direct write bypasses CachingStorageAdapter.upload, so evict the key. */
  private async invalidateCache(storageKey: string): Promise<void> {
    const adapter = this.storageAdapter as unknown as {
      invalidateKey?: (key: string) => Promise<void>;
      getUnderlyingAdapter?: () => { invalidateKey?: (key: string) => Promise<void> };
    };
    const target = adapter.invalidateKey ? adapter : adapter.getUnderlyingAdapter?.();
    try {
      await target?.invalidateKey?.(storageKey);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for ${storageKey}: ${(err as Error).message}`);
    }
  }
}
