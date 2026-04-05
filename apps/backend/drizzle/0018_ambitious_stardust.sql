CREATE TABLE "alias_proxy_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias_id" uuid NOT NULL,
	"proxy_rule_set_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alias_proxy_rule_sets" ADD CONSTRAINT "alias_proxy_rule_sets_alias_id_deployment_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."deployment_aliases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alias_proxy_rule_sets" ADD CONSTRAINT "alias_proxy_rule_sets_proxy_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("proxy_rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alias_proxy_rule_sets_alias_ruleset_unique" ON "alias_proxy_rule_sets" USING btree ("alias_id","proxy_rule_set_id");--> statement-breakpoint
CREATE INDEX "alias_proxy_rule_sets_alias_id_idx" ON "alias_proxy_rule_sets" USING btree ("alias_id");--> statement-breakpoint
CREATE INDEX "alias_proxy_rule_sets_rule_set_id_idx" ON "alias_proxy_rule_sets" USING btree ("proxy_rule_set_id");