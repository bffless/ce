import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Configuration for the data_upsert_many handler.
 */
export interface DataUpsertManyHandlerConfig {
  /**
   * Target Data-Table schema ID to insert into.
   */
  schemaId: string;

  /**
   * Expression that resolves to the source array (e.g. "steps.parse.entries").
   * A null/undefined result is treated as an empty batch (no-op).
   */
  items: string;

  /**
   * Field mappings applied per source item: { schemaColumn: "expression" }.
   * Each expression is evaluated with the current array element exposed as
   * `steps.item` (so e.g. "steps.item.title"), alongside the normal pipeline
   * context (request/steps/user/...). Defaults, timestamps, etc. are just
   * literal/`now()` expressions here.
   */
  map: Record<string, string>;

  /**
   * The schema column that stores the dedup key. The existence check queries
   * this column, and the handler forces each inserted record's value for this
   * column to the resolved dedup key so re-runs round-trip correctly.
   * Must be one of the target schema's fields.
   */
  dedupField: string;

  /**
   * How to compute each item's dedup value. A single expression, or an ordered
   * fallback chain of expressions — the first that resolves to a non-empty
   * string wins (e.g. ["steps.item.guid", "steps.item.link"]). If none resolve,
   * a deterministic content hash of the mapped record is used, so a stable key
   * always exists and re-runs never duplicate.
   */
  dedupKey: string | string[];

  /**
   * Condition expression - if provided, step only runs if this evaluates to true
   */
  condition?: string;
}

/** Per-item failure captured during mapping (does not sink the batch). */
interface UpsertError {
  index: number;
  error: string;
}

/** Structured output of the data_upsert_many handler. */
export interface DataUpsertManyOutput {
  inserted: number;
  skipped: number;
  errored: number;
  total: number;
  /** IDs of the newly-inserted records. */
  insertedIds: string[];
  /** Per-item errors (mapping/validation failures), if any. */
  errors: UpsertError[];
}

/** The current array element is exposed to expressions under this step key. */
const ITEM_SCOPE = 'item';

/**
 * data_upsert_many — a generic pipeline handler that inserts an array of records
 * into a target Data-Table schema, skipping any whose dedup-key value already
 * exists. Insert-only: existing rows are never overwritten, so per-record state
 * (e.g. an RSS reader's read/starred flags) survives re-runs.
 *
 * This is where the item-level loop lives — the CE pattern that avoids a generic
 * executor `foreach`. Nothing here is feed-specific; it's usable for any
 * sync/import/webhook batch.
 */
@Injectable()
export class DataUpsertManyHandler implements StepHandler<DataUpsertManyHandlerConfig> {
  readonly type = 'data_upsert_many' as const;
  private readonly logger = new Logger(DataUpsertManyHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly dataService: PipelineDataService,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DataUpsertManyHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'data_upsert_many');
    }
    if (!config.items) {
      throw new ConfigurationError('items expression is required', 'data_upsert_many');
    }
    if (!config.map || Object.keys(config.map).length === 0) {
      throw new ConfigurationError('At least one field mapping is required', 'data_upsert_many');
    }
    if (!config.dedupField) {
      throw new ConfigurationError('dedupField is required', 'data_upsert_many');
    }
    const chain = this.dedupChain(config.dedupKey);
    if (chain.length === 0) {
      throw new ConfigurationError(
        'dedupKey is required (an expression or a non-empty array of expressions)',
        'data_upsert_many',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DataUpsertManyHandlerConfig;
    const stepName = step.name || 'data_upsert_many';

    // Resolve + authorize the target schema (same guard as data_create).
    const schema = await this.schemasService.getById(config.schemaId);
    if (!schema) {
      throw new SchemaNotFoundError(config.schemaId, stepName);
    }
    if (schema.projectId !== context.projectId) {
      throw new ConfigurationError(
        `Schema '${config.schemaId}' does not belong to this project`,
        stepName,
      );
    }

    // dedupField is interpolated into SQL downstream — it must be a real column.
    const fieldNames = new Set(schema.fields.map((f) => f.name));
    if (!fieldNames.has(config.dedupField)) {
      throw new ConfigurationError(
        `dedupField '${config.dedupField}' is not a field of schema '${schema.name}'`,
        stepName,
      );
    }

    // Resolve the source array.
    const rawItems = this.expressionEvaluator.evaluateExpression(config.items, context, stepName);
    if (rawItems === null || rawItems === undefined) {
      return { success: true, output: this.emptyOutput() };
    }
    if (!Array.isArray(rawItems)) {
      throw new ConfigurationError(
        `items expression '${config.items}' must resolve to an array, got ${typeof rawItems}`,
        stepName,
      );
    }

    const chain = this.dedupChain(config.dedupKey);
    const errors: UpsertError[] = [];

    // 1. Map every item, compute its authoritative dedup value, dedupe within
    //    the batch. Per-item mapping failures are collected, not thrown.
    const seen = new Set<string>();
    const candidates: { key: string; data: Record<string, unknown> }[] = [];
    let batchDuplicates = 0;

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemContext = this.withItem(context, item);
      try {
        const data = this.mapItem(config.map, itemContext, stepName);
        const key = this.resolveDedupKey(chain, itemContext, data, stepName);

        // Force the stored dedup column to the resolved key so the existence
        // check round-trips even when the key came from a fallback/hash.
        data[config.dedupField] = key;

        this.validateRequired(schema.fields, data, config.dedupField);

        if (seen.has(key)) {
          batchDuplicates++; // duplicate within this batch → keep the first only
          continue;
        }
        seen.add(key);
        candidates.push({ key, data });
      } catch (error) {
        errors.push({ index: i, error: (error as Error).message });
      }
    }

    // 2. Find which keys already exist and drop them (insert-only, no overwrite).
    const existing = await this.dataService.findExistingKeys(
      config.schemaId,
      context.projectId,
      config.dedupField,
      candidates.map((c) => c.key),
    );
    const toInsert = candidates.filter((c) => !existing.has(c.key));

    // 3. Bulk insert the genuinely-new records.
    const alias = context.deployment?.alias ?? null;
    const insertedRecords = await this.dataService.createMany(
      config.schemaId,
      context.projectId,
      toInsert.map((c) => c.data),
      context.user?.id,
      alias,
      schema.version,
    );

    const skipped = batchDuplicates + (candidates.length - toInsert.length);
    this.logger.debug(
      `data_upsert_many: ${insertedRecords.length} inserted, ${skipped} skipped, ${errors.length} errored (of ${rawItems.length})`,
    );

    const output: DataUpsertManyOutput = {
      inserted: insertedRecords.length,
      skipped,
      errored: errors.length,
      total: rawItems.length,
      insertedIds: insertedRecords.map((r) => r.id),
      errors,
    };
    return { success: true, output };
  }

  /** Build a per-item context clone exposing the element as `steps.item`. */
  private withItem(context: PipelineContext, item: unknown): PipelineContext {
    return {
      ...context,
      stepOutputs: { ...context.stepOutputs, [ITEM_SCOPE]: item },
    };
  }

  /** Evaluate the field map for one item into a record object. */
  private mapItem(
    map: Record<string, string>,
    itemContext: PipelineContext,
    stepName: string,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [column, expression] of Object.entries(map)) {
      data[column] = this.expressionEvaluator.evaluateExpression(expression, itemContext, stepName);
    }
    return data;
  }

  /**
   * Resolve an item's dedup value: first non-empty expression in the chain,
   * else a stable hash of the mapped record (so a key always exists).
   */
  private resolveDedupKey(
    chain: string[],
    itemContext: PipelineContext,
    mappedData: Record<string, unknown>,
    stepName: string,
  ): string {
    for (const expr of chain) {
      const value = this.expressionEvaluator.evaluateExpression(expr, itemContext, stepName);
      if (value !== null && value !== undefined && String(value).trim().length > 0) {
        return String(value).trim();
      }
    }
    // Deterministic fallback: hash the mapped record (sorted keys for stability).
    const canonical = JSON.stringify(mappedData, Object.keys(mappedData).sort());
    return `hash:${createHash('sha256').update(canonical).digest('hex')}`;
  }

  /** Validate required fields are present, ignoring the forced dedup column. */
  private validateRequired(
    fields: { name: string; required: boolean }[],
    data: Record<string, unknown>,
    dedupField: string,
  ): void {
    const missing: string[] = [];
    for (const field of fields) {
      if (field.name === dedupField) continue;
      if (field.required && (data[field.name] === undefined || data[field.name] === null)) {
        missing.push(field.name);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Missing required field(s): ${missing.join(', ')}`);
    }
  }

  /** Normalize dedupKey config into an ordered expression list. */
  private dedupChain(dedupKey: string | string[] | undefined): string[] {
    if (Array.isArray(dedupKey)) {
      return dedupKey.filter((e) => typeof e === 'string' && e.trim().length > 0);
    }
    if (typeof dedupKey === 'string' && dedupKey.trim().length > 0) {
      return [dedupKey];
    }
    return [];
  }

  private emptyOutput(): DataUpsertManyOutput {
    return { inserted: 0, skipped: 0, errored: 0, total: 0, insertedIds: [], errors: [] };
  }
}
