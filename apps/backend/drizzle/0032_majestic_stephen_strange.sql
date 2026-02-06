ALTER TABLE "deployment_aliases" ADD COLUMN "is_auto_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD COLUMN "base_path" varchar(512);