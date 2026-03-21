import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export interface StoreEmbeddingParams {
  pipelineDataId: string;
  schemaId: string;
  fieldName: string;
  embedding: number[];
  chunkIndex?: number;
  chunkText?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchParams {
  schemaId: string;
  fieldName: string;
  queryVector: number[];
  limit?: number;
  threshold?: number;
  projectId: string;
}

export interface VectorSearchResult {
  id: string;
  pipelineDataId: string;
  similarity: number;
  chunkIndex: number | null;
  chunkText: string | null;
  metadata: unknown;
  data: unknown;
}

/**
 * Format a number[] as a pgvector literal, avoiding JavaScript scientific notation
 * (e.g., 1e-7) which pgvector cannot parse.
 */
function toVectorLiteral(values: number[]): string {
  return `'[${values.map((v) => Number(v).toFixed(20)).join(',')}]'::vector`;
}

@Injectable()
export class PipelineEmbeddingsService {
  private readonly logger = new Logger(PipelineEmbeddingsService.name);
  private readonly indexCache = new Set<string>();

  /**
   * Store a single embedding
   */
  async storeEmbedding(params: StoreEmbeddingParams): Promise<string> {
    await this.ensureHnswIndex(params.schemaId, params.fieldName, params.embedding.length);

    const vectorLiteral = toVectorLiteral(params.embedding);
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO pipeline_data_embeddings (pipeline_data_id, schema_id, field_name, embedding, chunk_index, chunk_text, metadata)
      VALUES (${params.pipelineDataId}, ${params.schemaId}, ${params.fieldName}, ${sql.raw(vectorLiteral)}, ${params.chunkIndex ?? null}, ${params.chunkText ?? null}, ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb)
      RETURNING id
    `);
    return result[0].id;
  }

  /**
   * Store multiple embeddings (for chunked documents)
   */
  async storeEmbeddings(
    params: Array<StoreEmbeddingParams>,
  ): Promise<string[]> {
    if (params.length === 0) return [];

    const first = params[0];
    await this.ensureHnswIndex(first.schemaId, first.fieldName, first.embedding.length);

    const ids: string[] = [];
    for (const p of params) {
      const id = await this.storeEmbedding(p);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Search embeddings by cosine similarity, joining to pipeline_data for full records
   */
  async vectorSearch(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const { schemaId, fieldName, queryVector, limit = 10, threshold, projectId } = params;

    const vectorLiteral = sql.raw(toVectorLiteral(queryVector));
    const thresholdClause = threshold != null
      ? sql`AND (1 - (e.embedding <=> ${vectorLiteral})) >= ${threshold}`
      : sql``;

    const results = await db.execute(sql`
      SELECT
        e.id,
        e.pipeline_data_id AS "pipelineDataId",
        1 - (e.embedding <=> ${vectorLiteral}) AS similarity,
        e.chunk_index AS "chunkIndex",
        e.chunk_text AS "chunkText",
        e.metadata,
        pd.data
      FROM pipeline_data_embeddings e
      JOIN pipeline_data pd ON pd.id = e.pipeline_data_id
      WHERE e.schema_id = ${schemaId}
        AND e.field_name = ${fieldName}
        AND pd.project_id = ${projectId}
        ${thresholdClause}
      ORDER BY e.embedding <=> ${vectorLiteral}
      LIMIT ${limit}
    `);

    return Array.from(results) as unknown as VectorSearchResult[];
  }

  /**
   * Delete all embeddings for a pipeline_data record (for re-embedding)
   */
  async deleteByPipelineDataId(pipelineDataId: string): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM pipeline_data_embeddings
      WHERE pipeline_data_id = ${pipelineDataId}
      RETURNING id
    `);
    return result.length;
  }

  /**
   * Create an HNSW index for cosine similarity on a (schema_id, field_name) pair.
   * Auto-called on first write — the index name encodes the dimension.
   */
  private async ensureHnswIndex(
    schemaId: string,
    fieldName: string,
    dimension: number,
  ): Promise<void> {
    const cacheKey = `${schemaId}:${fieldName}:${dimension}`;
    if (this.indexCache.has(cacheKey)) return;

    // Sanitize for index name: replace non-alphanumeric with underscore
    const safeName = `${schemaId}_${fieldName}`.replace(/[^a-zA-Z0-9]/g, '_');
    const indexName = `hnsw_${safeName}_${dimension}`;

    try {
      // Check if index already exists to avoid noisy NOTICE logs
      const existing = await db.execute(sql`
        SELECT 1 FROM pg_indexes WHERE indexname = ${indexName} LIMIT 1
      `);
      if (existing.length > 0) {
        this.indexCache.add(cacheKey);
        return;
      }

      await db.execute(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS "${indexName}" ON pipeline_data_embeddings USING hnsw ((embedding::vector(${dimension})) vector_cosine_ops) WHERE schema_id = '${schemaId}' AND field_name = '${fieldName}'`,
        ),
      );
      this.indexCache.add(cacheKey);
      this.logger.log(`Created HNSW index "${indexName}" (dim=${dimension})`);
    } catch (error) {
      // Index creation may fail if dimension mismatches — log but don't crash
      this.logger.warn(`Failed to create HNSW index "${indexName}": ${error}`);
    }
  }
}
