CREATE TABLE "project_default_proxy_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"proxy_rule_set_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_default_proxy_rule_sets" ADD CONSTRAINT "project_default_proxy_rule_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_default_proxy_rule_sets" ADD CONSTRAINT "project_default_proxy_rule_sets_proxy_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("proxy_rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_default_proxy_rule_sets_project_ruleset_unique" ON "project_default_proxy_rule_sets" USING btree ("project_id","proxy_rule_set_id");--> statement-breakpoint
CREATE INDEX "project_default_proxy_rule_sets_project_id_idx" ON "project_default_proxy_rule_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_default_proxy_rule_sets_rule_set_id_idx" ON "project_default_proxy_rule_sets" USING btree ("proxy_rule_set_id");