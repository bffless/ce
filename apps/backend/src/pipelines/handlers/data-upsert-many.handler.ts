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
import { coerceFieldsToSchema } from './field-coercion.util';

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
   * Optional whitelist of columns to refresh when a row with the dedup key
   * already exists. Absent (default) → insert-only: existing rows are never
   * overwritten, so per-record state (read/starred/fetchedAt) survives re-runs.
   * Present → those columns — and only those — are updated from the item's mapped
   * values when they differ from the stored row; every other column (including
   * per-record state and the dedup column) is preserved. Unchanged rows are not
   * written. Each entry must be a key of `map` and must not be the dedupField.
   */
  updateFields?: string[];

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
  /** Existing rows whose whitelisted (updateFields) columns changed and were updated. */
  updated: number;
  /** Within-batch duplicates plus existing rows left unchanged (not inserted, not updated). */
  skipped: number;
  errored: number;
  total: number;
  /** IDs of the newly-inserted records. */
  insertedIds: string[];
  /** IDs of the existing records whose whitelisted columns were updated. */
  updatedIds: string[];
  /** Per-item errors (mapping/validation failures), if any. */
  errors: UpsertError[];
}

/** The current array element is exposed to expressions under this step key. */
const ITEM_SCOPE = 'item';

/**
 * data_upsert_many — a generic pipeline handler that inserts an array of records
 * into a target Data-Table schema, skipping any whose dedup-key value already
 * exists. Insert-only by default: existing rows are never overwritten, so
 * per-record state (e.g. an RSS reader's read/starred flags) survives re-runs.
 * When `updateFields` is set, an existing row instead has that whitelist of
 * columns refreshed (only when a value changed); all other columns are still
 * preserved.
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
    if (config.updateFields !== undefined) {
      if (
        !Array.isArray(config.updateFields) ||
        config.updateFields.length === 0 ||
        config.updateFields.some((f) => typeof f !== 'string' || f.trim().length === 0)
      ) {
        throw new ConfigurationError(
          'updateFields must be a non-empty array of column names',
          'data_upsert_many',
        );
      }
      for (const field of config.updateFields) {
        if (field === config.dedupField) {
          throw new ConfigurationError(
            `updateFields cannot include the dedup column '${config.dedupField}'`,
            'data_upsert_many',
          );
        }
        if (!(field in config.map)) {
          throw new ConfigurationError(
            `updateFields entry '${field}' must be a column present in map`,
            'data_upsert_many',
          );
        }
      }
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
        const mapped = this.mapItem(config.map, itemContext, stepName);
        const key = this.resolveDedupKey(chain, itemContext, mapped, stepName);

        // Force the stored dedup column to the resolved key so the existence
        // check round-trips even when the key came from a fallback/hash.
        mapped[config.dedupField] = key;

        // Coerce values to the schema's declared field types
        const { data, errors: coercionErrors } = coerceFieldsToSchema(mapped, schema.fields);
        if (Object.keys(coercionErrors).length > 0) {
          throw new Error(Object.values(coercionErrors).join('; '));
        }

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

    const alias = context.deployment?.alias ?? null;
    const updateFields = config.updateFields;

    let toInsert: { key: string; data: Record<string, unknown> }[];
    let updatedIds: string[] = [];
    // Existing rows that matched but were left untouched (already-present in
    // insert-only mode, or unchanged in update mode).
    let existingUnchanged: number;

    if (updateFields && updateFields.length > 0) {
      // 2a. Update-on-conflict: fetch matched rows so we can compare + refresh.
      const existingRows = await this.dataService.findExistingRecordsByKeys(
        config.schemaId,
        context.projectId,
        config.dedupField,
        candidates.map((c) => c.key),
      );

      toInsert = [];
      const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
      let unchanged = 0;
      for (const candidate of candidates) {
        const existing = existingRows.get(candidate.key);
        if (!existing) {
          toInsert.push(candidate); // genuinely new → insert
          continue;
        }
        const fields = this.pickChangedFields(updateFields, candidate.data, existing.data);
        if (fields) {
          toUpdate.push({ id: existing.id, fields });
        } else {
          unchanged++; // whitelisted columns identical → leave the row alone
        }
      }

      if (toUpdate.length > 0) {
        updatedIds = await this.dataService.updateManyFields(toUpdate);
      }
      existingUnchanged = unchanged;
    } else {
      // 2b. Insert-only (default): find existing keys and drop them, no overwrite.
      const existing = await this.dataService.findExistingKeys(
        config.schemaId,
        context.projectId,
        config.dedupField,
        candidates.map((c) => c.key),
      );
      toInsert = candidates.filter((c) => !existing.has(c.key));
      existingUnchanged = candidates.length - toInsert.length;
    }

    // 3. Bulk insert the genuinely-new records.
    const insertedRecords = await this.dataService.createMany(
      config.schemaId,
      context.projectId,
      toInsert.map((c) => c.data),
      context.user?.id,
      alias,
      schema.version,
    );

    const skipped = batchDuplicates + existingUnchanged;
    this.logger.debug(
      `data_upsert_many: ${insertedRecords.length} inserted, ${updatedIds.length} updated, ${skipped} skipped, ${errors.length} errored (of ${rawItems.length})`,
    );

    const output: DataUpsertManyOutput = {
      inserted: insertedRecords.length,
      updated: updatedIds.length,
      skipped,
      errored: errors.length,
      total: rawItems.length,
      insertedIds: insertedRecords.map((r) => r.id),
      updatedIds,
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

  /**
   * Compare an item's mapped values against the stored row for the whitelisted
   * columns. Returns a partial object of just those columns when at least one
   * differs (so it can be merged into the row), or null when all are identical
   * (so the row is left untouched — no needless write / updatedAt churn).
   *
   * A field that resolved to `undefined` (absent in the source item) is treated
   * as "no new information": it is neither compared nor written. This keeps a
   * source that drops a previously-present field from both clearing the stored
   * value AND churning updatedAt on every refresh (JSON.stringify omits undefined
   * keys, so the merge would silently no-op it while still flagging a change). An
   * explicit `null` mapping is a real value and still updates/clears the column.
   *
   * Comparison is by JSON serialization, so a stored "5" vs a mapped 5 counts as
   * changed. Intended for scalar columns; object/array-valued fields whose keys
   * serialize in a different order would read as changed every run.
   */
  private pickChangedFields(
    updateFields: string[],
    mapped: Record<string, unknown>,
    stored: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const fields: Record<string, unknown> = {};
    let changed = false;
    for (const field of updateFields) {
      const value = mapped[field];
      if (value === undefined) continue; // absent in source → leave stored value alone
      fields[field] = value;
      if (JSON.stringify(value) !== JSON.stringify(stored[field])) {
        changed = true;
      }
    }
    return changed ? fields : null;
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
    return {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errored: 0,
      total: 0,
      insertedIds: [],
      updatedIds: [],
      errors: [],
    };
  }
}
