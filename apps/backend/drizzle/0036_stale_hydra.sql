CREATE TABLE "domain_blocklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_mapping_id" uuid NOT NULL,
	"blocklist_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocklists" ADD COLUMN "is_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_blocklists" ADD CONSTRAINT "domain_blocklists_domain_mapping_id_domain_mappings_id_fk" FOREIGN KEY ("domain_mapping_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_blocklists" ADD CONSTRAINT "domain_blocklists_blocklist_id_blocklists_id_fk" FOREIGN KEY ("blocklist_id") REFERENCES "public"."blocklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_blocklists_domain_blocklist_unique" ON "domain_blocklists" USING btree ("domain_mapping_id","blocklist_id");--> statement-breakpoint
CREATE INDEX "domain_blocklists_domain_mapping_id_idx" ON "domain_blocklists" USING btree ("domain_mapping_id");--> statement-breakpoint
CREATE INDEX "domain_blocklists_blocklist_id_idx" ON "domain_blocklists" USING btree ("blocklist_id");