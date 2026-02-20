ALTER TABLE "proxy_rules" ADD COLUMN "proxy_type" varchar(50) DEFAULT 'external_proxy';--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD COLUMN "email_handler_config" jsonb;--> statement-breakpoint
CREATE INDEX "proxy_rules_proxy_type_idx" ON "proxy_rules" USING btree ("proxy_type");