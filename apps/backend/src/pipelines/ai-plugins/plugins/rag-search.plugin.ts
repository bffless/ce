import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { sql, eq, desc, asc, SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { pipelineData } from '../../../db/schema';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolDefinition,
  AIToolContext,
} from '../ai-tool-plugin.interface';
import { AIToolPluginRegistry } from '../ai-tool-plugin.registry';
import { PipelineEmbeddingsService } from '../../pipeline-embeddings.service';
import { PipelineSchemasService } from '../../pipeline-schemas.service';
import { PipelineDataService } from '../../pipeline-data.service';
import { ProjectAISettingsService } from '../../../projects/project-ai-settings.service';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1000;

/**
 * Base source config shared by all source types.
 */
interface BaseSource {
  type: 'vector_search' | 'data_query';
  toolName: string;
  toolDescription?: string;
  schemaId: string;
  limit?: number;
  enableSaveNote?: boolean;
  instructions?: string;
}

/**
 * Vector search source — semantic similarity via embeddings.
 */
interface VectorSearchSource extends BaseSource {
  type: 'vector_search';
  embeddingModel: string;
  embeddingInputField?: string;
  embeddingInputTemplate?: string;
  fieldName: string;
  threshold?: number;
}

/**
 * Data query source — exact field match, returns records filtered and sorted.
 */
interface DataQuerySource extends BaseSource {
  type: 'data_query';
  /** Field to filter on (e.g., "user_id") */
  filterField?: string;
  /** Where the filter value comes from */
  filterSource?: 'user_id' | 'tool_input';
  /** Label for the tool input parameter when filterSource is "tool_input" */
  filterInputLabel?: string;
  /** Description for the tool input parameter */
  filterInputDescription?: string;
  /** Field to sort by (default: "createdAt") */
  sortField?: string;
  /** Sort direction (default: "desc") */
  sortDirection?: 'asc' | 'desc';
}

type Source = VectorSearchSource | DataQuerySource;

/**
 * AI Data Tools plugin — gives the AI tools to search and query pipeline data.
 *
 * Supports two source types:
 * - **vector_search**: Semantic similarity search via Replicate embeddings + pgvector
 * - **data_query**: Exact field matching with sort/limit (e.g., "get notes for this user")
 *
 * Each source creates its own named tool. Multiple sources can be configured per pipeline.
 */
@Injectable()
export class RagSearchPlugin implements AIToolPlugin {
  private readonly logger = new Logger(RagSearchPlugin.name);

  readonly metadata: AIToolPluginMetadata = {
    id: 'rag-search',
    name: 'AI Data Tools',
    description:
      'Give the AI tools to search and query your pipeline data. Supports semantic search (vector embeddings) and exact data lookups. Vector search requires Replicate in AI Services.',
    category: 'information',
    icon: 'database',
    pipelineOptionsSchema: z.object({
      sources: z
        .array(z.any())
        .describe('Data sources — each creates its own tool for the AI'),
    }),
  };

  constructor(
    private readonly registry: AIToolPluginRegistry,
    private readonly embeddingsService: PipelineEmbeddingsService,
    private readonly schemasService: PipelineSchemasService,
    private readonly dataService: PipelineDataService,
    private readonly projectAISettingsService: ProjectAISettingsService,
  ) {
    this.registry.register(this);
  }

  getSystemPromptInstructions(pipelineOptions?: Record<string, unknown>): string | null {
    const sources = this.parseSources(pipelineOptions);
    if (sources.length === 0) return null;

    const sections: string[] = ['## AI Data Tools'];

    for (const source of sources) {
      if (source.instructions) {
        sections.push(
          `**\`rag-search_${source.toolName}\`**: ${source.instructions}`,
        );
      } else {
        const typeLabel = source.type === 'vector_search' ? 'semantic search' : 'data lookup';
        sections.push(
          `**\`rag-search_${source.toolName}\`**: Use this tool for ${typeLabel}. ` +
            'Incorporate results naturally — do not mention that you performed a lookup.',
        );
      }

      if (source.enableSaveNote) {
        sections.push(
          `**\`rag-search_${source.toolName}_save\`**: Save new information to this source for future retrieval.`,
        );
      }
    }

    return sections.join('\n\n');
  }

  getTools(_config: Record<string, unknown>): AIToolDefinition[] {
    // Tools are built dynamically via getToolsWithOptions
    return [];
  }

  getToolsWithOptions(
    _config: Record<string, unknown>,
    pipelineOptions?: Record<string, unknown>,
  ): AIToolDefinition[] {
    const sources = this.parseSources(pipelineOptions);
    if (sources.length === 0) return [];

    const tools: AIToolDefinition[] = [];

    for (const source of sources) {
      if (source.type === 'vector_search') {
        this.buildVectorSearchTools(source, tools);
      } else if (source.type === 'data_query') {
        this.buildDataQueryTools(source, tools);
      }
    }

    return tools;
  }

  // ===== Tool Builders =====

  private buildVectorSearchTools(source: VectorSearchSource, tools: AIToolDefinition[]): void {
    tools.push({
      name: source.toolName,
      description:
        source.toolDescription ||
        'Search for relevant information using a natural language query. Returns matching records ranked by semantic similarity.',
      inputSchema: z.object({
        query: z.string().describe('Natural language search query'),
      }),
      execute: async (args: { query: string }, context: AIToolContext) => {
        return this.vectorSearch(args.query, source, context.projectId);
      },
    });

    if (source.enableSaveNote) {
      tools.push({
        name: `${source.toolName}_save`,
        description: `Save a new record and generate an embedding for future retrieval via ${source.toolName}.`,
        inputSchema: z.object({
          data: z.record(z.string(), z.unknown()).describe('The data fields to store'),
          textToEmbed: z.string().describe('The text to generate an embedding from'),
        }),
        execute: async (
          args: { data: Record<string, unknown>; textToEmbed: string },
          context: AIToolContext,
        ) => {
          return this.vectorSaveNote(args.data, args.textToEmbed, source, context.projectId);
        },
      });
    }
  }

  private buildDataQueryTools(source: DataQuerySource, tools: AIToolDefinition[]): void {
    // Build input schema based on filter source
    const inputFields: Record<string, z.ZodType> = {};

    if (source.filterSource === 'tool_input') {
      const label = source.filterInputLabel || source.filterField || 'value';
      inputFields[label] = z.string().describe(
        source.filterInputDescription || `Value to filter by ${source.filterField || 'field'}`,
      );
    }

    tools.push({
      name: source.toolName,
      description:
        source.toolDescription ||
        'Look up records from the database. Returns matching records.',
      inputSchema: z.object(inputFields),
      execute: async (args: Record<string, string>, context: AIToolContext) => {
        return this.dataQuery(args, source, context);
      },
    });

    if (source.enableSaveNote) {
      tools.push({
        name: `${source.toolName}_save`,
        description: `Save a new record to the ${source.toolName} data source.`,
        inputSchema: z.object({
          data: z.record(z.string(), z.unknown()).describe('The data fields to store'),
        }),
        execute: async (
          args: { data: Record<string, unknown> },
          context: AIToolContext,
        ) => {
          return this.dataSaveNote(args.data, source, context.projectId);
        },
      });
    }
  }

  // ===== Vector Search Operations =====

  private async vectorSearch(
    query: string,
    source: VectorSearchSource,
    projectId: string,
  ): Promise<{ results: Array<Record<string, unknown>> } | { error: string }> {
    const schema = await this.schemasService.getById(source.schemaId);
    if (!schema || schema.projectId !== projectId) {
      return { error: 'Schema not found or does not belong to this project' };
    }

    try {
      const inputField = source.embeddingInputField || 'text';
      const inputTemplate = source.embeddingInputTemplate || '{{query}}';
      const queryVector = await this.generateEmbedding(
        query, source.embeddingModel, projectId, inputField, inputTemplate,
      );

      if (!queryVector) {
        return { error: 'Failed to generate embedding. Check Replicate API configuration.' };
      }

      const results = await this.embeddingsService.vectorSearch({
        schemaId: source.schemaId,
        fieldName: source.fieldName,
        queryVector,
        limit: source.limit ?? 5,
        threshold: source.threshold,
        projectId,
      });

      const formatted = results.map((r) => {
        const dataFields = (r.data ?? {}) as Record<string, unknown>;
        return {
          id: r.pipelineDataId,
          similarity: Math.round(r.similarity * 1000) / 1000,
          ...(r.chunkText != null ? { chunkText: r.chunkText } : {}),
          ...(r.chunkIndex != null ? { chunkIndex: r.chunkIndex } : {}),
          ...dataFields,
        };
      });

      this.logger.debug(`Vector search [${source.toolName}] for "${query}" returned ${formatted.length} results`);
      return { results: formatted };
    } catch (error) {
      this.logger.error(`Vector search failed: ${(error as Error).message}`);
      return { error: `Search failed: ${(error as Error).message}` };
    }
  }

  private async vectorSaveNote(
    data: Record<string, unknown>,
    textToEmbed: string,
    source: VectorSearchSource,
    projectId: string,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const schema = await this.schemasService.getById(source.schemaId);
    if (!schema || schema.projectId !== projectId) {
      return { success: false, error: 'Schema not found or does not belong to this project' };
    }

    try {
      const record = await this.dataService.create(source.schemaId, projectId, data);

      const inputField = source.embeddingInputField || 'text';
      const inputTemplate = source.embeddingInputTemplate || '{{query}}';
      const embedding = await this.generateEmbedding(
        textToEmbed, source.embeddingModel, projectId, inputField, inputTemplate,
      );

      if (!embedding) {
        return { success: true, id: record.id, error: 'Record saved but embedding generation failed.' };
      }

      await this.embeddingsService.storeEmbedding({
        pipelineDataId: record.id,
        schemaId: source.schemaId,
        fieldName: source.fieldName,
        embedding,
      });

      return { success: true, id: record.id };
    } catch (error) {
      return { success: false, error: `Failed to save: ${(error as Error).message}` };
    }
  }

  // ===== Data Query Operations =====

  private async dataQuery(
    args: Record<string, string>,
    source: DataQuerySource,
    context: AIToolContext,
  ): Promise<{ results: Array<Record<string, unknown>> } | { error: string }> {
    const { projectId } = context;

    const schema = await this.schemasService.getById(source.schemaId);
    if (!schema || schema.projectId !== projectId) {
      return { error: 'Schema not found or does not belong to this project' };
    }

    try {
      const conditions: SQL[] = [
        eq(pipelineData.schemaId, source.schemaId),
        eq(pipelineData.projectId, projectId),
      ];

      // Apply filter
      if (source.filterField) {
        let filterValue: string | undefined;

        if (source.filterSource === 'user_id') {
          filterValue = context.userId;
          if (!filterValue) {
            return { error: 'User is not authenticated. Cannot filter by user_id.' };
          }
        } else if (source.filterSource === 'tool_input') {
          const inputLabel = source.filterInputLabel || source.filterField || 'value';
          filterValue = args[inputLabel];
        }

        if (filterValue) {
          // Filter on JSONB data field
          conditions.push(
            sql`${pipelineData.data}->>${sql.raw(`'${source.filterField}'`)} = ${filterValue}`,
          );
        }
      }

      // Build query
      const sortField = source.sortField || 'createdAt';
      const sortDir = source.sortDirection || 'desc';
      const limit = source.limit ?? 10;

      // Sort by data field or built-in column
      let orderBy: SQL;
      if (sortField === 'createdAt') {
        orderBy = sortDir === 'asc' ? asc(pipelineData.createdAt) : desc(pipelineData.createdAt);
      } else if (sortField === 'updatedAt') {
        orderBy = sortDir === 'asc' ? asc(pipelineData.updatedAt) : desc(pipelineData.updatedAt);
      } else {
        // Sort by JSONB data field
        const sortExpr = sql`${pipelineData.data}->>${sql.raw(`'${sortField}'`)}`;
        orderBy = sortDir === 'asc' ? asc(sortExpr) : desc(sortExpr);
      }

      const whereClause = conditions.length > 1
        ? sql.join(conditions, sql` AND `)
        : conditions[0];

      const results = await db
        .select()
        .from(pipelineData)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit);

      const formatted = results.map((r) => {
        const dataFields = (r.data ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          createdAt: r.createdAt,
          ...dataFields,
        };
      });

      this.logger.debug(`Data query [${source.toolName}] returned ${formatted.length} results`);
      return { results: formatted };
    } catch (error) {
      this.logger.error(`Data query failed: ${(error as Error).message}`);
      return { error: `Query failed: ${(error as Error).message}` };
    }
  }

  private async dataSaveNote(
    data: Record<string, unknown>,
    source: DataQuerySource,
    projectId: string,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const schema = await this.schemasService.getById(source.schemaId);
    if (!schema || schema.projectId !== projectId) {
      return { success: false, error: 'Schema not found or does not belong to this project' };
    }

    try {
      const record = await this.dataService.create(source.schemaId, projectId, data);
      return { success: true, id: record.id };
    } catch (error) {
      return { success: false, error: `Failed to save: ${(error as Error).message}` };
    }
  }

  // ===== Embedding Generation =====

  private async generateEmbedding(
    text: string,
    model: string,
    projectId: string,
    inputField: string = 'text',
    inputTemplate: string = '{{query}}',
  ): Promise<number[] | null> {
    const serviceConfig = await this.projectAISettingsService.getServiceConfig(projectId, 'replicate');
    if (!serviceConfig) {
      this.logger.warn('Replicate API token not configured');
      return null;
    }

    try {
      const version = await this.resolveLatestVersion(model, serviceConfig.apiToken);
      const inputValue = inputTemplate.replace(/\{\{query\}\}/g, text);
      const input = { [inputField]: inputValue };

      const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceConfig.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ version, input }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        this.logger.error(`Replicate API error: ${(errorBody as Record<string, string>).detail || response.statusText}`);
        return null;
      }

      let prediction = (await response.json()) as Record<string, unknown>;

      if (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
        prediction = await this.pollPrediction(prediction.id as string, serviceConfig.apiToken);
      }

      if (prediction.status !== 'succeeded') {
        this.logger.error(`Embedding failed: ${prediction.error || prediction.status}`);
        return null;
      }

      let embedding = prediction.output as unknown;
      if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
        embedding = embedding[0];
      }

      if (!Array.isArray(embedding) || typeof embedding[0] !== 'number') {
        this.logger.error(`Unexpected embedding format: ${typeof embedding}`);
        return null;
      }

      return embedding as number[];
    } catch (error) {
      this.logger.error(`Embedding generation failed: ${(error as Error).message}`);
      return null;
    }
  }

  // ===== Helpers =====

  private parseSources(pipelineOptions?: Record<string, unknown>): Source[] {
    if (!pipelineOptions?.sources || !Array.isArray(pipelineOptions.sources)) return [];

    return pipelineOptions.sources.filter(
      (s): s is Source =>
        s &&
        typeof s === 'object' &&
        typeof s.toolName === 'string' &&
        typeof s.schemaId === 'string' &&
        (s.type === 'vector_search' || s.type === 'data_query'),
    );
  }

  private async resolveLatestVersion(model: string, apiToken: string): Promise<string> {
    try {
      const response = await fetch(`${REPLICATE_API_BASE}/models/${model}/versions`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) return model;
      const data = (await response.json()) as { results?: { id: string }[] };
      return data.results?.[0]?.id || model;
    } catch {
      return model;
    }
  }

  private async pollPrediction(predictionId: string, apiToken: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const response = await fetch(`${REPLICATE_API_BASE}/predictions/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) throw new Error(`Failed to poll prediction: ${response.statusText}`);
      const prediction = (await response.json()) as Record<string, unknown>;
      if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') {
        return prediction;
      }
    }
    throw new Error(`Prediction ${predictionId} timed out`);
  }
}
