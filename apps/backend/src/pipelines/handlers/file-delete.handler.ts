import { Injectable, Inject, Logger } from '@nestjs/common';
import * as path from 'path';
import { StepHandler, FileDeleteHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError, StepExecutionError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { UploadRecordService } from '../upload-record.service';

/**
 * File Delete Handler
 *
 * Deletes objects within the calling project's uploads root
 * ({owner}/{repo}/uploads/) — the same root file_upload/file_serve address via
 * `subDir`. Operates in three mutually-exclusive modes:
 *
 *   - prefix: list every object under <uploadsRoot>/<prefix> and delete them all
 *             (object stores have no atomic folder delete, so this is list+delete).
 *   - key:    delete a single object at <uploadsRoot>/<key>.
 *   - keys:   delete an explicit set of objects that share no common prefix
 *             (e.g. a Site manifest's assets), each at <uploadsRoot>/<entry>.
 *             `keys` is either a static array of key templates, or a single
 *             expression STRING that resolves at runtime to an array of keys —
 *             the dynamic, variable-length case (e.g. a Site manifest mapped to
 *             its object keys) that a static array can't express. A resolved
 *             empty array is a no-op (`{ deleted: 0 }`), not an error.
 *
 * `prefix`, `key`, and every entry of `keys` are relative to the uploads root
 * and are expression-interpolated before use. This is a destructive handler, so it
 * defends itself: blank prefixes and path traversal are rejected before any
 * storage call (a blank prefix must NEVER mean "delete the whole uploads root").
 *
 * Idempotent: a prefix/key matching nothing returns { deleted: 0 }, not an error.
 */
@Injectable()
export class FileDeleteHandler implements StepHandler<FileDeleteHandlerConfig> {
  readonly type = 'file_delete' as const;
  private readonly logger = new Logger(FileDeleteHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly uploadRecords: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FileDeleteHandlerConfig): void {
    const hasPrefix = typeof config.prefix === 'string' && config.prefix.length > 0;
    const hasKey = typeof config.key === 'string' && config.key.length > 0;
    const hasKeys = config.keys !== undefined;

    const modes = [hasPrefix, hasKey, hasKeys].filter(Boolean).length;
    if (modes > 1) {
      throw new ConfigurationError(
        'Provide exactly one of "prefix", "key", or "keys"',
        'file_delete',
      );
    }
    if (modes === 0) {
      throw new ConfigurationError(
        'One of "prefix", "key", or "keys" is required',
        'file_delete',
      );
    }

    if (hasKeys) {
      // `keys` may be a static array of key templates, OR a single expression
      // string that resolves to an array at runtime (validated when it runs).
      if (typeof config.keys === 'string') {
        if (config.keys.trim().length === 0) {
          throw new ConfigurationError(
            '"keys" expression must be a non-empty string',
            'file_delete',
          );
        }
      } else if (Array.isArray(config.keys)) {
        if (config.keys.length === 0) {
          throw new ConfigurationError('"keys" must be a non-empty array', 'file_delete');
        }
        if (!config.keys.every((k) => typeof k === 'string' && k.length > 0)) {
          throw new ConfigurationError(
            'Every entry in "keys" must be a non-empty string',
            'file_delete',
          );
        }
      } else {
        throw new ConfigurationError(
          '"keys" must be an array of strings or an expression string',
          'file_delete',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FileDeleteHandlerConfig;
    const stepName = step.name || 'file_delete';
    const dryRun = config.dryRun === true;

    const { owner, repo } = await this.uploadRecords.resolveOwnerRepo(context, stepName);
    const uploadsRoot = `${owner}/${repo}/uploads/`;

    const isKeysMode = config.keys !== undefined;
    if (isKeysMode) {
      const keyList = this.resolveKeyList(config.keys!, context, stepName);
      // Resolve and guard EVERY entry before any storage call, so a single bad
      // entry aborts the whole step without partially deleting the good ones.
      const targets = keyList.map((expr) => {
        const relKey = this.resolveAndGuard(expr, context, stepName, 'key');
        const fullKey = this.confineToRoot(uploadsRoot, relKey, stepName);
        return { relKey, fullKey };
      });
      return this.deleteMany(targets, dryRun, stepName);
    }

    const isKeyMode = typeof config.key === 'string' && config.key.length > 0;

    if (isKeyMode) {
      const relKey = this.resolveAndGuard(config.key!, context, stepName, 'key');
      const fullKey = this.confineToRoot(uploadsRoot, relKey, stepName);
      return this.deleteSingle(fullKey, relKey, dryRun, stepName);
    }

    const relPrefix = this.resolveAndGuard(config.prefix!, context, stepName, 'prefix');
    const fullPrefix = this.confineToRoot(uploadsRoot, relPrefix, stepName);
    return this.deletePrefix(fullPrefix, relPrefix, dryRun, stepName);
  }

  /**
   * Produce the list of key expressions for `keys` mode.
   *
   *   - Array form: a static list of key templates, used as-is (each is still
   *     interpolated + guarded downstream).
   *   - String form: a single expression that must resolve to an array of
   *     strings at runtime — the dynamic, variable-length case (e.g. a prior
   *     step parsing a Site manifest into its object keys). A resolved empty
   *     array is allowed (it makes the whole step a no-op).
   */
  private resolveKeyList(
    keys: string[] | string,
    context: PipelineContext,
    stepName: string,
  ): string[] {
    if (Array.isArray(keys)) {
      return keys;
    }

    const resolved = this.expressionEvaluator.evaluateExpression(keys, context, stepName);
    if (!Array.isArray(resolved)) {
      throw new ConfigurationError(
        `"keys" expression "${keys}" must resolve to an array, but resolved to ${typeof resolved}`,
        stepName,
      );
    }
    if (!resolved.every((k) => typeof k === 'string')) {
      throw new ConfigurationError(
        `"keys" expression "${keys}" must resolve to an array of strings`,
        stepName,
      );
    }
    return resolved as string[];
  }

  /**
   * Interpolate the prefix/key expression, then enforce the safety rules that
   * must hold regardless of how the value was produced.
   */
  private resolveAndGuard(
    expression: string,
    context: PipelineContext,
    stepName: string,
    field: 'prefix' | 'key',
  ): string {
    const resolved = this.expressionEvaluator.evaluateTemplate(expression, context, stepName);
    const trimmed = (resolved ?? '').trim();

    // A blank prefix/key must never fall through to "everything under uploads".
    if (!trimmed || trimmed === '/') {
      throw new ConfigurationError(
        `Resolved ${field} is empty — refusing to delete (a blank ${field} would target the entire uploads root)`,
        stepName,
      );
    }

    // No traversal / escape sequences, ever.
    if (resolved.includes('..')) {
      throw new ConfigurationError(
        `Resolved ${field} "${resolved}" contains ".." — path traversal is not allowed`,
        stepName,
      );
    }

    // Strip leading slashes so the value stays relative to the uploads root.
    return resolved.replace(/^\/+/, '');
  }

  /**
   * Join the relative prefix/key onto the uploads root and assert the result
   * stays inside that root — a final defense against any escape the explicit
   * ".." check missed (e.g. via interpolation).
   */
  private confineToRoot(uploadsRoot: string, relative: string, stepName: string): string {
    const full = `${uploadsRoot}${relative}`;
    const normalized = path.posix.normalize(full);
    if (normalized !== uploadsRoot && !normalized.startsWith(uploadsRoot)) {
      throw new ConfigurationError(
        `Resolved path "${normalized}" escapes the project's uploads root — refusing to delete`,
        stepName,
      );
    }
    return full;
  }

  private async deleteSingle(
    fullKey: string,
    relKey: string,
    dryRun: boolean,
    stepName: string,
  ): Promise<StepResult> {
    try {
      const exists = await this.storageAdapter.exists(fullKey);
      if (!exists) {
        return { success: true, output: { deleted: 0, key: relKey, dryRun } };
      }
      if (!dryRun) {
        await this.storageAdapter.delete(fullKey);
        this.logger.debug(`Deleted object ${fullKey}`);
      }
      return { success: true, output: { deleted: 1, key: relKey, dryRun } };
    } catch (error) {
      throw new StepExecutionError(
        `Failed to delete "${relKey}": ${(error as Error).message}`,
        stepName,
      );
    }
  }

  /**
   * Delete an explicit set of objects that share no common prefix. Each is
   * deleted independently; missing objects are skipped (idempotent), and any
   * per-object failures are collected and surfaced together so partial success
   * is never silently swallowed.
   */
  private async deleteMany(
    targets: { relKey: string; fullKey: string }[],
    dryRun: boolean,
    stepName: string,
  ): Promise<StepResult> {
    let deleted = 0;
    const failed: string[] = [];

    for (const { relKey, fullKey } of targets) {
      try {
        const exists = await this.storageAdapter.exists(fullKey);
        if (!exists) {
          continue;
        }
        if (!dryRun) {
          await this.storageAdapter.delete(fullKey);
          this.logger.debug(`Deleted object ${fullKey}`);
        }
        deleted++;
      } catch {
        failed.push(relKey);
      }
    }

    const keys = targets.map((t) => t.relKey);

    if (failed.length > 0) {
      throw new StepExecutionError(
        `Deleted ${deleted} object(s) but ${failed.length} failed`,
        stepName,
        { deleted, failed },
      );
    }

    return { success: true, output: { deleted, keys, dryRun } };
  }

  private async deletePrefix(
    fullPrefix: string,
    relPrefix: string,
    dryRun: boolean,
    stepName: string,
  ): Promise<StepResult> {
    try {
      if (dryRun) {
        const keys = await this.storageAdapter.listKeys(fullPrefix);
        return { success: true, output: { deleted: keys.length, prefix: relPrefix, dryRun } };
      }

      const { deleted, failed } = await this.storageAdapter.deletePrefix(fullPrefix);

      if (failed.length > 0) {
        throw new StepExecutionError(
          `Deleted ${deleted} object(s) under "${relPrefix}" but ${failed.length} failed`,
          stepName,
          { deleted, failed },
        );
      }

      this.logger.debug(`Deleted ${deleted} object(s) under ${fullPrefix}`);
      return { success: true, output: { deleted, prefix: relPrefix, dryRun } };
    } catch (error) {
      if (error instanceof StepExecutionError) {
        throw error;
      }
      throw new StepExecutionError(
        `Failed to delete prefix "${relPrefix}": ${(error as Error).message}`,
        stepName,
      );
    }
  }
}
