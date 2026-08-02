import { Injectable, BadRequestException } from '@nestjs/common';
import { unzip } from 'fflate';
import { createHash } from 'crypto';
import { validateAppManifest } from './app-manifest.util';
import type { AppManifest } from './app-manifest.types';

/**
 * Build provenance stamped into the bundle by bffless/apps' scripts/build-app-bundle.mjs
 * (`.bffless-build.json`). Absent on bundles built before that change, and on any build whose
 * commit could not be resolved — absence is a normal state, never an error.
 */
export interface BundleBuildInfo {
  /** 40-hex commit whose tree produced this bundle. */
  commit: string;
}

export interface LoadedBundle {
  manifest: AppManifest;
  /** entry path -> bytes; directory entries stripped */
  files: Record<string, Uint8Array>;
  sha256: string;
  /**
   * Source provenance, read from inside the bundle rather than from the registry entry: it
   * travels with the bytes, so it is covered by the same sha256 the registry pins and can
   * never attribute a bundle to a commit that did not produce it. Undefined when unstamped.
   */
  build?: BundleBuildInfo;
}

const BUILD_INFO_ENTRY = '.bffless-build.json';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * AppBundleService — downloads/parses an app bundle zip, verifying its
 * sha256 before doing any (potentially expensive) parsing, and validating
 * the manifest + declared ruleSet files are actually present in the zip.
 */
@Injectable()
export class AppBundleService {
  private readonly MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
  private readonly DOWNLOAD_TIMEOUT_MS = 30_000;
  private readonly MAX_CACHE_ENTRIES = 3;
  private readonly cache = new Map<string, LoadedBundle>();

  async fetchBundle(url: string, expectedSha256: string): Promise<LoadedBundle> {
    if (expectedSha256) {
      const cached = this.cache.get(expectedSha256.toLowerCase());
      if (cached) {
        // Bump recency (Map preserves insertion order).
        this.cache.delete(cached.sha256);
        this.cache.set(cached.sha256, cached);
        return cached;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.DOWNLOAD_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new BadRequestException(`Bundle download failed with HTTP ${res.status}`);
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > this.MAX_BUNDLE_BYTES) {
        throw new BadRequestException(
          `Bundle size (${contentLength} bytes) exceeds the maximum allowed size of ${this.MAX_BUNDLE_BYTES} bytes`,
        );
      }
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > this.MAX_BUNDLE_BYTES) {
      throw new BadRequestException(
        `Bundle size (${arrayBuffer.byteLength} bytes) exceeds the maximum allowed size of ${this.MAX_BUNDLE_BYTES} bytes`,
      );
    }

    return this.loadFromBuffer(new Uint8Array(arrayBuffer), expectedSha256);
  }

  async loadFromBuffer(buf: Uint8Array, expectedSha256?: string): Promise<LoadedBundle> {
    const actualSha256 = createHash('sha256').update(buf).digest('hex').toLowerCase();

    if (expectedSha256 && expectedSha256.toLowerCase() !== actualSha256) {
      throw new BadRequestException(
        `Bundle sha256 mismatch: expected ${expectedSha256.toLowerCase()}, got ${actualSha256}`,
      );
    }

    const cached = this.cache.get(actualSha256);
    if (cached) {
      // Bump recency (Map preserves insertion order).
      this.cache.delete(actualSha256);
      this.cache.set(actualSha256, cached);
      return cached;
    }

    const files = await this.unzip(buf);

    const manifestBytes = files['bffless-app.json'];
    if (!manifestBytes) {
      throw new BadRequestException('Bundle is missing required file: bffless-app.json');
    }

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch (error) {
      throw new BadRequestException(
        `bffless-app.json is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const validated = validateAppManifest(manifestJson);
    if (!validated.ok) {
      throw new BadRequestException(`bffless-app.json failed validation: ${validated.errors.join('; ')}`);
    }
    const manifest = validated.manifest;

    for (const ruleSet of manifest.install.ruleSets) {
      if (!files[ruleSet.file]) {
        throw new BadRequestException(`Bundle declared file missing: ${ruleSet.file}`);
      }
    }

    const deploymentPrefix = `${manifest.install.deployment.path.replace(/\/+$/, '')}/`;
    const hasDeploymentFiles = Object.keys(files).some((entryPath) =>
      entryPath.startsWith(deploymentPrefix),
    );
    if (!hasDeploymentFiles) {
      throw new BadRequestException(
        `Bundle has no files under the declared deployment path: ${manifest.install.deployment.path}`,
      );
    }

    const loaded: LoadedBundle = {
      manifest,
      files,
      sha256: actualSha256,
      build: this.readBuildInfo(files),
    };
    this.cache.set(actualSha256, loaded);
    if (this.cache.size > this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }

    return loaded;
  }

  /**
   * Reads the optional build stamp. Deliberately total: a bundle whose stamp is missing,
   * unparseable, or not a 40-hex commit still installs — it simply carries no provenance, and
   * the caller falls back to the bundle hash. Rejecting the bundle would turn a cosmetic
   * regression in the publisher into an outage for every install of that app.
   */
  private readBuildInfo(files: Record<string, Uint8Array>): BundleBuildInfo | undefined {
    const bytes = files[BUILD_INFO_ENTRY];
    if (!bytes) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return undefined;
    }

    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const commit = (parsed as { commit?: unknown }).commit;
    if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return undefined;

    return { commit: commit.toLowerCase() };
  }

  private unzip(buf: Uint8Array): Promise<Record<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      unzip(buf, (err, result) => {
        if (err) {
          reject(new BadRequestException(`Failed to parse bundle zip: ${err.message}`));
          return;
        }
        const files: Record<string, Uint8Array> = {};
        for (const [entryPath, contentArray] of Object.entries(result)) {
          if (entryPath.endsWith('/')) continue; // directory entry
          files[entryPath] = contentArray;
        }
        resolve(files);
      });
    });
  }
}
