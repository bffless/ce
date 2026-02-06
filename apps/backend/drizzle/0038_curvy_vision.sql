CREATE TABLE "retention_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" uuid,
	"commit_sha" varchar(40) NOT NULL,
	"branch" varchar(255),
	"asset_count" integer NOT NULL,
	"freed_bytes" bigint NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"branch_pattern" varchar(255) NOT NULL,
	"exclude_branches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer NOT NULL,
	"keep_with_alias" boolean DEFAULT true NOT NULL,
	"keep_minimum" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_run_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retention_logs" ADD CONSTRAINT "retention_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_logs" ADD CONSTRAINT "retention_logs_rule_id_retention_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."retention_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rules" ADD CONSTRAINT "retention_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retention_logs_project_id_idx" ON "retention_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "retention_logs_rule_id_idx" ON "retention_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "retention_logs_deleted_at_idx" ON "retention_logs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "retention_logs_project_deleted_at_idx" ON "retention_logs" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "retention_rules_project_id_idx" ON "retention_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "retention_rules_next_run_idx" ON "retention_rules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "retention_rules_enabled_next_run_idx" ON "retention_rules" USING btree ("enabled","next_run_at");