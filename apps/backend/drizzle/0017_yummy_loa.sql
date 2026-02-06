ALTER TABLE "system_config" ADD COLUMN "email_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "email_config" text;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "email_configured" boolean DEFAULT false NOT NULL;