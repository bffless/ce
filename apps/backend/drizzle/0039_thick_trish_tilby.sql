CREATE TABLE "proxy_rule_set_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source" jsonb,
	"trigger" varchar(20) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_rule_set_revisions" ADD CONSTRAINT "proxy_rule_set_revisions_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_rule_set_revisions_set_created_idx" ON "proxy_rule_set_revisions" USING btree ("rule_set_id","created_at");