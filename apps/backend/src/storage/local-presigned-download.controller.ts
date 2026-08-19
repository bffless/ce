import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { IStorageAdapter, STORAGE_ADAPTER } from './storage.interface';
import { verifyLocalDownload } from './presign.util';
import { resolveLocalAdapter } from './local.adapter';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { resolveContentType } from '../common/utils/content-type.util';
import {
  sanitizeDownloadFilename,
  formatAttachmentDisposition,
} from '../common/utils/download-filename.util';

/**
 * Deliberately `unknown`, not `string`: Express's query parser yields objects
 * (`?dl[a]=b`) and arrays (`?dl=1&dl=2`) as well as strings, and typing these
 * as `string` would be a lie the compiler then stops us from checking. The
 * handler narrows them before use.
 */
interface PresignDownloadQuery {
  key?: unknown;
  exp?: unknown;
  sig?: unknown;
  dl?: unknown;
}

/**
 * Signature-authorized DOWNLOAD route for local filesystem storage — the GET
 * sibling of {@link LocalPresignedUploadController}, mounted at the SAME path
 * (`/api/storage/presigned/local`) deliberately.
 *
 * Same path, because the per-vhost nginx `location = /api/storage/presigned/local`
 * blocks added for the upload feature proxy this path to the backend
 * unrewritten on every vhost that can serve a local-storage app (deployment
 * subdomains, custom domains, the CE primary domain, the wildcard catch-all
 * and admin). None of them restricts the method (`limit_except` appears
 * nowhere in the nginx templates), so a GET on the same path inherits that
 * reachability with zero nginx changes. Any NEW path would have needed five
 * template edits before a single signed link worked.
 *
 * Like the upload route, this has NO auth guard: authorization IS the HMAC
 * signature minted by `LocalStorageAdapter.getUrl`, exactly as an S3 presigned
 * GET carries its own. No cookie, session or API key is consulted, so it can't
 * act as a confused deputy. The signature is verified BEFORE any filesystem
 * access.
 */
@ApiTags('Storage')
@Controller('api/storage/presigned')
export class LocalPresignedDownloadController {
  private readonly logger = new Logger(LocalPresignedDownloadController.name);

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  @Get('local')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Download bytes from local storage using a signed URL' })
  @ApiResponse({ status: 200, description: 'File contents' })
  async download(
    @Query() query: PresignDownloadQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // 1. Flag — one "local presigned URLs" capability covers both directions,
    //    so the route 404s (rather than advertising itself) when it's off.
    if (!(await this.featureFlags.isEnabled('ENABLE_LOCAL_PRESIGNED_UPLOADS'))) {
      throw new NotFoundException();
    }

    // 2. Active adapter must be local AND willing to mint signed URLs at all.
    //    Same predicate as the upload route: an install whose only signing
    //    material is the public dev-fallback constant must not HONOUR
    //    signatures forged with it either.
    const local = resolveLocalAdapter(this.storageAdapter);
    if (!local || !local.supportsPresignedUrls()) throw new NotFoundException();

    // 3. Params.
    //
    // TYPES FIRST. Express's query parser turns `?dl[a]=b` into an object and
    // `?dl=1&dl=2` into an array, so nothing here is a string until proven
    // one. Without this guard a structured `dl` reaches
    // `canonicalDownloadString`, where `Buffer.from(object)` throws INSIDE the
    // signature computation — i.e. an unauthenticated 500, reachable before
    // any signature is validated.
    const { key: encodedKey, exp: expRaw, sig, dl } = query;
    if (
      typeof encodedKey !== 'string' ||
      typeof expRaw !== 'string' ||
      typeof sig !== 'string' ||
      (dl !== undefined && typeof dl !== 'string')
    ) {
      throw new BadRequestException('Malformed signed download parameters');
    }
    if (!encodedKey || !expRaw || !sig) {
      throw new BadRequestException('Missing signed download parameters');
    }
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) {
      throw new BadRequestException('Malformed signed download parameters');
    }

    let storageKey: string;
    try {
      storageKey = Buffer.from(encodedKey, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Malformed key parameter');
    }

    // 4. Signature — before ANY filesystem access, so an unsigned request can
    //    never probe for the existence of a key.
    if (!verifyLocalDownload({ key: storageKey, exp, dl }, sig, local.getDownloadPresignKey())) {
      this.logger.warn(`Rejected signed download with invalid signature for key: ${storageKey}`);
      throw new ForbiddenException('Invalid download signature');
    }

    // 5. Expiry.
    if (exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('Download URL has expired');
    }

    // 6. Key confinement — defence in depth; the signature already binds the
    //    key, so reaching here means the key was minted by us. Mirrors the
    //    upload route's rejections exactly (`..`, NUL, leading/trailing
    //    slashes), plus a resolved-path check against the storage root so a
    //    form this normalization didn't anticipate still cannot escape.
    if (storageKey !== this.normalizeKey(storageKey)) {
      throw new BadRequestException('Invalid storage key');
    }
    const basePath = local.getStorageBasePath();
    const fullPath = path.resolve(basePath, storageKey);
    if (fullPath !== basePath && !fullPath.startsWith(`${basePath}${path.sep}`)) {
      throw new BadRequestException('Invalid storage key');
    }

    // 7. The file itself. 404 (not 403) — the signature was valid, there is
    //    simply nothing there.
    let size: number;
    let lastModified: Date;
    try {
      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) throw new NotFoundException();
      size = stats.size;
      lastModified = stats.mtime;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException();
      throw err;
    }

    res.setHeader('Content-Type', resolveContentType(storageKey));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Last-Modified', lastModified.toUTCString());
    // Signed and time-bounded: never store it in a shared cache, and never
    // let a private cache outlive the signature.
    const remaining = Math.max(0, exp - Math.floor(Date.now() / 1000));
    res.setHeader('Cache-Control', `private, max-age=${remaining}`);

    // `dl` is re-sanitized here, not trusted from the query: a signed URL is
    // minted once and then replayed by an untrusted client, and this value is
    // interpolated straight into a header.
    //
    // formatAttachmentDisposition, not raw interpolation: a filename with any
    // character above U+00FF makes res.setHeader throw ERR_INVALID_CHAR, and
    // EVERY macOS screenshot carries U+202F between the time and AM/PM. Those
    // names arrive here for real — Studio's sign rule passes the user's own
    // filename straight through — so this path 500'd on a very ordinary file.
    const filename = sanitizeDownloadFilename(dl);
    if (filename) {
      res.setHeader('Content-Disposition', formatAttachmentDisposition(filename));
    }

    // 8. Range — videos need seeking, and fs.createReadStream gives inclusive
    //    start/end offsets for free (same mechanism LocalStorageAdapter.
    //    downloadStream uses).
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match && (match[1] || match[2])) {
        let start: number;
        let end: number;

        if (match[1]) {
          start = parseInt(match[1], 10);
          end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
        } else {
          // SUFFIX form. `bytes=-N` (what `curl -r -N` sends) means the LAST N
          // bytes, not bytes 0..N — RFC 9110 §14.1.2. Reading match[1] as a
          // defaulted 0 would serve the wrong bytes AND mislabel them in
          // Content-Range, which a video player would happily render as
          // garbage. A zero-length suffix is unsatisfiable by definition and
          // falls into the 416 below via start > end.
          const suffix = parseInt(match[2], 10);
          start = Math.max(0, size - suffix);
          end = suffix === 0 ? -1 : size - 1;
        }

        if (start >= size || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        this.pipe(fsSync.createReadStream(fullPath, { start, end }), res, storageKey);
        return;
      }
      // A Range header this route can't parse (or an unsupported unit) falls
      // through to the full 200 response, which RFC 9110 permits.
    }

    res.setHeader('Content-Length', size);
    this.pipe(fsSync.createReadStream(fullPath), res, storageKey);
  }

  /** Mirrors LocalStorageAdapter.sanitizeKey's normalization. */
  private normalizeKey(key: string): string {
    if (key.includes('..') || key.includes('\0')) return '';
    return key.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Pipe to the response, destroying the read stream if the client goes away
   * mid-transfer (a seeking video player cancels in-flight range requests
   * constantly) so the fd isn't held open.
   */
  private pipe(stream: fsSync.ReadStream, res: Response, storageKey: string): void {
    stream.on('error', (err) => {
      this.logger.error(`Failed streaming ${storageKey}: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
