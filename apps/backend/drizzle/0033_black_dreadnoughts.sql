-- Delete existing proxy rules since we're changing the schema (rule_set_id is NOT NULL)
DELETE FROM "proxy_rules";
--> statement-breakpoint
CREATE TABLE "proxy_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"environment" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_rules" DROP CONSTRAINT "proxy_rules_scope_check";--> statement-breakpoint
ALTER TABLE "proxy_rules" DROP CONSTRAINT "proxy_rules_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "proxy_rules" DROP CONSTRAINT "proxy_rules_alias_id_deployment_aliases_id_fk";
--> statement-breakpoint
DROP INDEX "proxy_rules_project_path_unique";--> statement-breakpoint
DROP INDEX "proxy_rules_alias_path_unique";--> statement-breakpoint
DROP INDEX "proxy_rules_project_id_idx";--> statement-breakpoint
DROP INDEX "proxy_rules_alias_id_idx";--> statement-breakpoint
DROP INDEX "proxy_rules_project_order_idx";--> statement-breakpoint
DROP INDEX "proxy_rules_alias_order_idx";--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD COLUMN "proxy_rule_set_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_proxy_rule_set_id" uuid;--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD COLUMN "rule_set_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_rule_sets" ADD CONSTRAINT "proxy_rule_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rule_sets_project_name_unique" ON "proxy_rule_sets" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "proxy_rule_sets_project_id_idx" ON "proxy_rule_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proxy_rule_sets_environment_idx" ON "proxy_rule_sets" USING btree ("project_id","environment");--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD CONSTRAINT "deployment_aliases_proxy_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("proxy_rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD CONSTRAINT "proxy_rules_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rules_rule_set_path_unique" ON "proxy_rules" USING btree ("rule_set_id","path_pattern");--> statement-breakpoint
CREATE INDEX "proxy_rules_rule_set_id_idx" ON "proxy_rules" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX "proxy_rules_rule_set_order_idx" ON "proxy_rules" USING btree ("rule_set_id","order");--> statement-breakpoint
ALTER TABLE "proxy_rules" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "proxy_rules" DROP COLUMN "alias_id";