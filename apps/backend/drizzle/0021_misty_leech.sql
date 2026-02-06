CREATE TABLE "domain_traffic_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"weight" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_traffic_weights_domain_alias_unique" UNIQUE("domain_id","alias")
);
--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "sticky_sessions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "sticky_session_duration" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_traffic_weights" ADD CONSTRAINT "domain_traffic_weights_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_traffic_weights_domain_id_idx" ON "domain_traffic_weights" USING btree ("domain_id");