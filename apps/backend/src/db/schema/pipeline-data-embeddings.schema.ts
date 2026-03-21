import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { pipelineData } from './pipeline-data.schema';
import { pipelineSchemas } from './pipeline-schemas.schema';

/**
 * Custom Drizzle type for pgvector's vector column.
 * Serializes number[] to pgvector text format '[1,2,3]' and back.
 * No fixed dimension — dimension is enforced by HNSW index per (schema_id, field_name).
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns '[1,2,3]' format
    return value
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

/**
 * Pipeline data embeddings table — stores vector embeddings for pipeline data records.
 * Supports 1:1 (single embedding per record) and 1:N (chunked documents).
 */
export const pipelineDataEmbeddings = pgTable(
  'pipeline_data_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineDataId: uuid('pipeline_data_id')
      .notNull()
      .references(() => pipelineData.id, { onDelete: 'cascade' }),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => pipelineSchemas.id, { onDelete: 'cascade' }),
    fieldName: varchar('field_name', { length: 255 }).notNull(),
    embedding: vector('embedding').notNull(),
    /** For chunked documents: index of this chunk (0-based) */
    chunkIndex: integer('chunk_index'),
    /** For chunked documents: the text content of this chunk */
    chunkText: text('chunk_text'),
    /** Optional metadata (e.g., source page, token count) */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('pipeline_data_embeddings_data_id_idx').on(table.pipelineDataId),
    index('pipeline_data_embeddings_schema_field_idx').on(table.schemaId, table.fieldName),
  ],
);

/**
 * Relations for pipeline data embeddings
 */
export const pipelineDataEmbeddingsRelations = relations(pipelineDataEmbeddings, ({ one }) => ({
  pipelineData: one(pipelineData, {
    fields: [pipelineDataEmbeddings.pipelineDataId],
    references: [pipelineData.id],
  }),
  schema: one(pipelineSchemas, {
    fields: [pipelineDataEmbeddings.schemaId],
    references: [pipelineSchemas.id],
  }),
}));

export type PipelineDataEmbedding = typeof pipelineDataEmbeddings.$inferSelect;
export type NewPipelineDataEmbedding = typeof pipelineDataEmbeddings.$inferInsert;
