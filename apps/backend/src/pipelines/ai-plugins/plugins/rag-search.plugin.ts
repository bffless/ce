import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
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
 * RAG Search plugin — gives the AI the ability to search pipeline data
 * using semantic similarity (vector embeddings).
 *
 * Project-level: just enable the plugin (uses existing Replicate API token from AI Services)
 * Pipeline-level: choose embedding model, schema, field, limits, etc.
 *
 * The AI gets two tools:
 * - `search`: generate embedding from text query, then vector search
 * - `save_note`: store a new note/record and embed it for future retrieval (opt-in)
 */
@Injectable()
export class RagSearchPlugin implements AIToolPlugin {
  private readonly logger = new Logger(RagSearchPlugin.name);

  readonly metadata: AIToolPluginMetadata = {
    id: 'rag-search',
    name: 'RAG Search',
    description:
      'Search and store data using semantic similarity. Enables AI to look up context from your pipeline data using natural language queries and save new information for future retrieval. Requires Replicate in AI Services.',
    category: 'information',
    icon: 'database',
    // No configSchema — uses Replicate API token from AI Services.
    // Embedding model is configured per-pipeline so different chat handlers can use different models.
    pipelineOptionsSchema: z.object({
      embeddingModel: z
        .string()
        .min(1)
        .describe(
          'Replicate embedding model (e.g., beautyyuyanli/multilingual-e5-large)',
        ),
      schemaId: z.string().min(1).describe('Pipeline schema to search'),
      fieldName: z
        .string()
        .min(1)
        .describe('Embedding field name (must match embed_store fieldName)'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results to return (default 5)'),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum similarity threshold (0-1)'),
      enableSaveNote: z
        .boolean()
        .optional()
        .describe('Enable the save_note tool for write-back'),
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

  getTools(_config: Record<string, unknown>): AIToolDefinition[] {
    return [
      {
        name: 'search',
        description:
          'Search for relevant information using a natural language query. Returns matching records ranked by semantic similarity.',
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              'Natural language search query (e.g., a name, topic, or question)',
            ),
        }),
        execute: async (
          args: { query: string },
          context: AIToolContext,
        ) => {
          return this.search(args.query, context);
        },
      },
      {
        name: 'save_note',
        description:
          'Save a new piece of information for future retrieval. Stores the data and generates an embedding so it can be found by semantic search later.',
        inputSchema: z.object({
          data: z
            .record(z.string(), z.unknown())
            .describe(
              'The data fields to store (e.g., { "name": "Hannah", "notes": "Moving back in June" })',
            ),
          textToEmbed: z
            .string()
            .describe(
              'The text to generate an embedding from. Should capture the key searchable content.',
            ),
        }),
        execute: async (
          args: { data: Record<string, unknown>; textToEmbed: string },
          context: AIToolContext,
        ) => {
          // Check if save_note is enabled in pipeline options
          if (!context.pipelineOptions?.enableSaveNote) {
            return {
              error:
                'The save_note tool is not enabled for this pipeline. Enable it in pipeline options.',
            };
          }
          return this.saveNote(args.data, args.textToEmbed, context);
        },
      },
    ];
  }

  private async search(
    query: string,
    context: AIToolContext,
  ): Promise<
    | { results: Array<Record<string, unknown>> }
    | { error: string }
  > {
    const { projectId, pipelineOptions } = context;
    const schemaId = pipelineOptions?.schemaId as string;
    const fieldName = pipelineOptions?.fieldName as string;
    const limit = (pipelineOptions?.limit as number) || 5;
    const threshold = pipelineOptions?.threshold as number | undefined;
    const embeddingModel = pipelineOptions?.embeddingModel as string;

    if (!schemaId || !fieldName || !embeddingModel) {
      return {
        error:
          'RAG Search plugin requires embeddingModel, schemaId, and fieldName in pipeline options',
      };
    }

    // Verify schema belongs to project
    const schema = await this.schemasService.getById(schemaId);
    if (!schema || schema.projectId !== projectId) {
      return { error: 'Schema not found or does not belong to this project' };
    }

    try {
      // Step 1: Generate embedding for the query text via Replicate
      const queryVector = await this.generateEmbedding(
        query,
        embeddingModel,
        projectId,
      );

      if (!queryVector) {
        return {
          error: 'Failed to generate embedding for query. Check Replicate API configuration.',
        };
      }

      // Step 2: Vector search
      const results = await this.embeddingsService.vectorSearch({
        schemaId,
        fieldName,
        queryVector,
        limit,
        threshold,
        projectId,
      });

      // Step 3: Format results — flatten data fields
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

      this.logger.debug(
        `RAG search for "${query}" returned ${formatted.length} results`,
      );

      return { results: formatted };
    } catch (error) {
      this.logger.error(`RAG search failed: ${(error as Error).message}`);
      return { error: `Search failed: ${(error as Error).message}` };
    }
  }

  /**
   * Save a new note/record to the schema and generate + store its embedding.
   */
  private async saveNote(
    data: Record<string, unknown>,
    textToEmbed: string,
    context: AIToolContext,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const { projectId, pipelineOptions } = context;
    const schemaId = pipelineOptions?.schemaId as string;
    const fieldName = pipelineOptions?.fieldName as string;
    const embeddingModel = pipelineOptions?.embeddingModel as string;

    if (!schemaId || !fieldName || !embeddingModel) {
      return {
        success: false,
        error: 'RAG Search plugin requires embeddingModel, schemaId, and fieldName in pipeline options',
      };
    }

    // Verify schema belongs to project
    const schema = await this.schemasService.getById(schemaId);
    if (!schema || schema.projectId !== projectId) {
      return {
        success: false,
        error: 'Schema not found or does not belong to this project',
      };
    }

    try {
      // Step 1: Create the data record
      const record = await this.dataService.create(
        schemaId,
        projectId,
        data,
      );

      // Step 2: Generate embedding
      const embedding = await this.generateEmbedding(
        textToEmbed,
        embeddingModel,
        projectId,
      );

      if (!embedding) {
        return {
          success: true,
          id: record.id,
          error: 'Record saved but embedding generation failed. The record will not appear in search results until re-embedded.',
        };
      }

      // Step 3: Store embedding
      await this.embeddingsService.storeEmbedding({
        pipelineDataId: record.id,
        schemaId,
        fieldName,
        embedding,
      });

      this.logger.debug(
        `Saved note and embedding for record ${record.id} in schema ${schemaId}`,
      );

      return { success: true, id: record.id };
    } catch (error) {
      this.logger.error(`Save note failed: ${(error as Error).message}`);
      return {
        success: false,
        error: `Failed to save note: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Generate an embedding vector using a Replicate model.
   */
  private async generateEmbedding(
    text: string,
    model: string,
    projectId: string,
  ): Promise<number[] | null> {
    // Get Replicate API token from project settings
    const serviceConfig =
      await this.projectAISettingsService.getServiceConfig(
        projectId,
        'replicate',
      );

    if (!serviceConfig) {
      this.logger.warn(
        'Replicate API token not configured for RAG Search embedding generation',
      );
      return null;
    }

    try {
      // Resolve model version
      const version = await this.resolveLatestVersion(
        model,
        serviceConfig.apiToken,
      );

      // Create prediction
      const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceConfig.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({
          version,
          input: { text },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        this.logger.error(
          `Replicate embedding API error: ${(errorBody as Record<string, string>).detail || response.statusText}`,
        );
        return null;
      }

      let prediction = (await response.json()) as Record<string, unknown>;

      // Poll if not completed
      if (
        prediction.status !== 'succeeded' &&
        prediction.status !== 'failed' &&
        prediction.status !== 'canceled'
      ) {
        prediction = await this.pollPrediction(
          prediction.id as string,
          serviceConfig.apiToken,
        );
      }

      if (prediction.status !== 'succeeded') {
        this.logger.error(
          `Embedding prediction failed: ${prediction.error || prediction.status}`,
        );
        return null;
      }

      // Extract embedding — unwrap nested arrays
      let embedding = prediction.output as unknown;
      if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
        embedding = embedding[0];
      }

      if (!Array.isArray(embedding) || typeof embedding[0] !== 'number') {
        this.logger.error(
          `Unexpected embedding output format: ${typeof embedding}`,
        );
        return null;
      }

      return embedding as number[];
    } catch (error) {
      this.logger.error(
        `Embedding generation failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async resolveLatestVersion(
    model: string,
    apiToken: string,
  ): Promise<string> {
    try {
      const response = await fetch(
        `${REPLICATE_API_BASE}/models/${model}/versions`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );

      if (!response.ok) {
        return model;
      }

      const data = (await response.json()) as {
        results?: { id: string }[];
      };
      const latestVersion = data.results?.[0]?.id;

      return latestVersion || model;
    } catch {
      return model;
    }
  }

  private async pollPrediction(
    predictionId: string,
    apiToken: string,
  ): Promise<Record<string, unknown>> {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(
        `${REPLICATE_API_BASE}/predictions/${predictionId}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to poll prediction: ${response.statusText}`,
        );
      }

      const prediction = (await response.json()) as Record<string, unknown>;

      if (
        prediction.status === 'succeeded' ||
        prediction.status === 'failed' ||
        prediction.status === 'canceled'
      ) {
        return prediction;
      }
    }

    throw new Error(
      `Prediction ${predictionId} timed out after ${MAX_POLL_ATTEMPTS} attempts`,
    );
  }
}
