CREATE TABLE "pipeline_data_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_data_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"embedding" vector NOT NULL,
	"chunk_index" integer,
	"chunk_text" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_data_embeddings" ADD CONSTRAINT "pipeline_data_embeddings_pipeline_data_id_pipeline_data_id_fk" FOREIGN KEY ("pipeline_data_id") REFERENCES "public"."pipeline_data"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_data_embeddings" ADD CONSTRAINT "pipeline_data_embeddings_schema_id_pipeline_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."pipeline_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_data_embeddings_data_id_idx" ON "pipeline_data_embeddings" USING btree ("pipeline_data_id");--> statement-breakpoint
CREATE INDEX "pipeline_data_embeddings_schema_field_idx" ON "pipeline_data_embeddings" USING btree ("schema_id","field_name");