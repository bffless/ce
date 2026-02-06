ALTER TABLE "domain_mappings" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "www_behavior" varchar(20);