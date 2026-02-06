CREATE TABLE "domain_traffic_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"condition_type" varchar(20) NOT NULL,
	"condition_key" varchar(255) NOT NULL,
	"condition_value" varchar(500) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"label" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_traffic_rules" ADD CONSTRAINT "domain_traffic_rules_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_traffic_rules_domain_id_idx" ON "domain_traffic_rules" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "domain_traffic_rules_domain_id_priority_idx" ON "domain_traffic_rules" USING btree ("domain_id","priority");