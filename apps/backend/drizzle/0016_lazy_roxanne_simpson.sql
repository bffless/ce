ALTER TABLE "system_config" ADD COLUMN "smtp_config" text;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "smtp_configured" boolean DEFAULT false NOT NULL;