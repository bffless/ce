ALTER TABLE "domain_mappings" ADD COLUMN "auto_renew_ssl" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "ssl_renewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "ssl_renewal_status" varchar(20);--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "ssl_renewal_error" text;