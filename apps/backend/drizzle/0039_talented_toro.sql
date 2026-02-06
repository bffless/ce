ALTER TABLE "retention_logs" ADD COLUMN "is_partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retention_rules" ADD COLUMN "path_patterns" jsonb;--> statement-breakpoint
ALTER TABLE "retention_rules" ADD COLUMN "path_mode" varchar(10);