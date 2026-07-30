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
import { resolveLocalAdapter } from './local.adapter';
import {
  LocalUploadWriterService,
  UploadTooLargeError,
  UploadIncompleteError,
} from './local-upload-writer.service';
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

    // 2. Active adapter must be local AND must itself be willing to mint
    //    presigned URLs. supportsPresignedUrls() is the exact predicate
    //    LocalStorageAdapter.getPresignedUploadUrl consults before minting one
    //    (see local.adapter.ts) -- it's false when the only signing material
    //    available is the hardcoded dev-fallback secret (no ENCRYPTION_KEY /
    //    LOCAL_PRESIGN_SECRET configured, no explicit presignKey injected).
    //    Checking it here closes the other half of that threat model: without
    //    this, an install that refuses to MINT URLs with the dev secret would
    //    still ACCEPT signatures forged with that same public constant. 404,
    //    not 403 -- the route must be indistinguishable from absent when it
    //    isn't usable, matching the non-local-adapter case just above (one
    //    predicate governs both directions: if it can't mint, it can't honour).
    const local = resolveLocalAdapter(this.storageAdapter);
    if (!local || !local.supportsPresignedUrls()) throw new NotFoundException();

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

    // Stream it. maxBytes is tightened to contentLength (never looser than
    // what quota was actually authorized against — max is only the signed
    // ceiling, contentLength is what this specific request declared and was
    // checked against quota above). expectedBytes makes the writer verify
    // the stream actually delivered that many bytes before it ever renames
    // into place — see UploadIncompleteError for why that matters.
    let result: { bytesWritten: number; etag: string };
    try {
      result = await this.writer.writeStream({
        source: req,
        basePath: local.getStorageBasePath(),
        storageKey,
        maxBytes: Math.min(max, contentLength),
        expectedBytes: contentLength,
      });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        throw new PayloadTooLargeException(err.message);
      }
      if (err instanceof UploadIncompleteError) {
        // A short body under a declared Content-Length is a malformed client
        // request (or, per the review that flagged this, the body was fully
        // consumed upstream by a body-parser before reaching here — e.g. a
        // non-octet-stream Content-Type). Either way this is a 4xx: the
        // request as sent didn't deliver what it promised. 400 over 500
        // because nothing on the server is broken and no server-side
        // exception occurred — the writer detected the mismatch and handled
        // it cleanly, leaving the target key untouched (see writeStream).
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    await this.invalidateCache(storageKey);

    res.setHeader('ETag', `"${result.etag}"`);
    res.status(HttpStatus.OK);
  }

  /** Mirrors LocalStorageAdapter.sanitizeKey's normalization. */
  private normalizeKey(key: string): string {
    if (key.includes('..') || key.includes('\0')) return '';
    return key.replace(/^\/+|\/+$/g, '');
  }

  /**
   * A direct write bypasses CachingStorageAdapter.upload, so evict the key.
   *
   * TODO: `storageKey` here is the PREFIXED key (it was decoded straight from
   * the URL, which LocalStorageAdapter.getPresignedUploadUrl built via
   * `this.prefixKey(this.sanitizeKey(key))`), but
   * CachingStorageAdapter.invalidateKey -> getCacheKey() expects the same
   * UNPREFIXED key its own upload()/download() callers use. That mismatch
   * only matters if a local adapter is ever configured with BOTH a
   * `keyPrefix` (workspace isolation) AND caching (`ENABLE_LRU_CACHE`) at the
   * same time -- in that combination this evicts the wrong cache entry and a
   * subsequent read could serve stale bytes for the just-uploaded key. Not
   * fixed here because no current deployment shape combines both, but if one
   * ever does, unprefix `storageKey` (LocalStorageAdapter.unprefixKey is
   * private -- either expose it or thread the unprefixed key through
   * separately) before calling invalidateKey.
   */
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
