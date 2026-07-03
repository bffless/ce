CREATE TABLE "pipeline_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"target_proxy_rule_id" uuid NOT NULL,
	"cron_expression" varchar(120) NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"execution_started_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_schedules" ADD CONSTRAINT "pipeline_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_schedules" ADD CONSTRAINT "pipeline_schedules_target_proxy_rule_id_proxy_rules_id_fk" FOREIGN KEY ("target_proxy_rule_id") REFERENCES "public"."proxy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_schedules_project_id_idx" ON "pipeline_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipeline_schedules_target_proxy_rule_id_idx" ON "pipeline_schedules" USING btree ("target_proxy_rule_id");--> statement-breakpoint
CREATE INDEX "pipeline_schedules_enabled_next_run_idx" ON "pipeline_schedules" USING btree ("enabled","next_run_at");