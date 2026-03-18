ALTER TABLE "pipeline_data" ADD COLUMN "alias" varchar(255);--> statement-breakpoint
ALTER TABLE "pipeline_data" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_schemas" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;