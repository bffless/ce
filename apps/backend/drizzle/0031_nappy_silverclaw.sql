ALTER TABLE "system_config" ADD COLUMN "install_id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "telemetry_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_config" ADD COLUMN "telemetry_last_sent" timestamp;