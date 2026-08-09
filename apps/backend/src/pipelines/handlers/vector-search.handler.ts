import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, VectorSearchHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { PipelineEmbeddingsService } from '../pipeline-embeddings.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Vector Search Handler
 *
 * Queries embeddings by cosine similarity, returning full pipeline_data records
 * ranked by similarity score.
 */
@Injectable()
export class VectorSearchHandler implements StepHandler<VectorSearchHandlerConfig> {
  readonly type = 'vector_search' as const;
  private readonly logger = new Logger(VectorSearchHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly embeddingsService: PipelineEmbeddingsService,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: VectorSearchHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'vector_search');
    }
    if (!config.fieldName) {
      throw new ConfigurationError('fieldName is required', 'vector_search');
    }
    if (!config.queryVector) {
      throw new ConfigurationError('queryVector expression is required', 'vector_search');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as VectorSearchHandlerConfig;
    const stepName = step.name || 'vector_search';

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

    // Resolve query vector
    const rawQueryVector = this.expressionEvaluator.evaluateExpression(
      config.queryVector,
      context,
      stepName,
    );

    // Unwrap nested arrays — some models return [[0.1, 0.2, ...]] instead of [0.1, 0.2, ...]
    let queryVector = rawQueryVector as number[];
    if (Array.isArray(queryVector) && Array.isArray(queryVector[0])) {
      queryVector = queryVector[0];
    }

    if (!Array.isArray(queryVector) || typeof queryVector[0] !== 'number') {
      return {
        success: false,
        error: {
          code: 'INVALID_QUERY_VECTOR',
          message: 'queryVector expression must resolve to a number array',
        },
      };
    }

    const results = await this.embeddingsService.vectorSearch({
      schemaId: config.schemaId,
      fieldName: config.fieldName,
      queryVector,
      limit: config.limit ?? 10,
      threshold: config.threshold,
      projectId: context.projectId,
    });

    // Format results: flatten data fields into each result, optionally filter by select
    const formatted = results.map((r) => {
      const dataFields = (r.data ?? {}) as Record<string, unknown>;
      const selected = config.select
        ? Object.fromEntries(
            config.select
              .filter((key) => key in dataFields)
              .map((key) => [key, dataFields[key]]),
          )
        : dataFields;

      return {
        id: r.pipelineDataId,
        similarity: r.similarity,
        ...(r.chunkText != null ? { chunkText: r.chunkText } : {}),
        ...(r.chunkIndex != null ? { chunkIndex: r.chunkIndex } : {}),
        ...(r.metadata != null ? { chunkMetadata: r.metadata } : {}),
        ...selected,
      };
    });

    this.logger.debug(
      `Vector search returned ${formatted.length} results for field '${config.fieldName}'`,
    );

    return {
      success: true,
      output: formatted,
    };
  }
}
