import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, EmbedStoreHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineEmbeddingsService } from '../pipeline-embeddings.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { PipelineDataService } from '../pipeline-data.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Embed Store Handler
 *
 * Stores embedding vectors in the pipeline_data_embeddings table.
 * Supports 1:1 (single embedding per record) and 1:N (chunked documents).
 */
@Injectable()
export class EmbedStoreHandler implements StepHandler<EmbedStoreHandlerConfig> {
  readonly type = 'embed_store' as const;
  private readonly logger = new Logger(EmbedStoreHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly embeddingsService: PipelineEmbeddingsService,
    private readonly schemasService: PipelineSchemasService,
    private readonly dataService: PipelineDataService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: EmbedStoreHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'embed_store');
    }
    if (!config.recordId) {
      throw new ConfigurationError('recordId is required', 'embed_store');
    }
    if (!config.fieldName) {
      throw new ConfigurationError('fieldName is required', 'embed_store');
    }
    if (!config.embedding && !config.chunks) {
      throw new ConfigurationError(
        'Either embedding or chunks expression is required',
        'embed_store',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as EmbedStoreHandlerConfig;
    const stepName = step.name || 'embed_store';

    // Verify schema exists and belongs to project
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

    // Resolve record ID
    const recordId = this.expressionEvaluator.evaluateExpression(
      config.recordId,
      context,
      stepName,
    ) as string;

    if (!recordId) {
      return {
        success: false,
        error: {
          code: 'INVALID_RECORD_ID',
          message: 'recordId expression resolved to empty value',
        },
      };
    }

    // Resolve optional metadata
    const metadata = config.metadata
      ? (this.expressionEvaluator.evaluateExpression(config.metadata, context, stepName) as Record<string, unknown>)
      : undefined;

    let stored = 0;

    if (config.chunks) {
      // 1:N chunked mode
      const chunks = this.expressionEvaluator.evaluateExpression(
        config.chunks,
        context,
        stepName,
      ) as Array<{ embedding: number[]; text?: string; metadata?: Record<string, unknown> }>;

      if (!Array.isArray(chunks)) {
        return {
          success: false,
          error: {
            code: 'INVALID_CHUNKS',
            message: 'chunks expression must resolve to an array',
          },
        };
      }

      // Delete existing embeddings for this record+field before re-storing
      await this.embeddingsService.deleteByPipelineDataId(recordId);

      const params = chunks.map((chunk, index) => ({
        pipelineDataId: recordId,
        schemaId: config.schemaId,
        fieldName: config.fieldName,
        embedding: chunk.embedding,
        chunkIndex: index,
        chunkText: chunk.text,
        metadata: { ...metadata, ...chunk.metadata },
      }));

      await this.embeddingsService.storeEmbeddings(params);
      stored = chunks.length;
    } else {
      // 1:1 single embedding mode
      const rawEmbedding = this.expressionEvaluator.evaluateExpression(
        config.embedding!,
        context,
        stepName,
      );

      // Unwrap nested arrays — some models return [[0.1, 0.2, ...]] instead of [0.1, 0.2, ...]
      let embedding = rawEmbedding as number[];
      if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
        embedding = embedding[0];
      }

      if (!Array.isArray(embedding) || typeof embedding[0] !== 'number') {
        return {
          success: false,
          error: {
            code: 'INVALID_EMBEDDING',
            message: `embedding expression must resolve to a number array, got ${typeof rawEmbedding}${Array.isArray(rawEmbedding) ? ` of ${typeof rawEmbedding[0]}` : ''}`,
          },
        };
      }

      // Delete existing embeddings for this record+field before re-storing
      await this.embeddingsService.deleteByPipelineDataId(recordId);

      await this.embeddingsService.storeEmbedding({
        pipelineDataId: recordId,
        schemaId: config.schemaId,
        fieldName: config.fieldName,
        embedding,
        metadata,
      });
      stored = 1;
    }

    this.logger.debug(
      `Stored ${stored} embedding(s) for record ${recordId}, field '${config.fieldName}'`,
    );

    return {
      success: true,
      output: {
        stored,
        fieldName: config.fieldName,
        recordId,
      },
    };
  }
}
