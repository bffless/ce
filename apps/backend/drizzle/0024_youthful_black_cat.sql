ALTER TABLE "system_config" ADD COLUMN "google_oauth_config" text;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "google_oauth_configured" boolean DEFAULT false NOT NULL;