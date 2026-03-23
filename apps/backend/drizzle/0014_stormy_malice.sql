CREATE TABLE "pipeline_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"proxy_rule_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"status_code" integer NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"duration_ms" integer NOT NULL,
	"steps_count" integer NOT NULL,
	"error_code" varchar(100),
	"error_message" text,
	"error_step" varchar(255),
	"request_meta" jsonb,
	"debug" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD COLUMN "debug_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_execution_logs" ADD CONSTRAINT "pipeline_execution_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_execution_logs" ADD CONSTRAINT "pipeline_execution_logs_proxy_rule_id_proxy_rules_id_fk" FOREIGN KEY ("proxy_rule_id") REFERENCES "public"."proxy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_exec_logs_rule_created_idx" ON "pipeline_execution_logs" USING btree ("proxy_rule_id","created_at");--> statement-breakpoint
CREATE INDEX "pipeline_exec_logs_project_idx" ON "pipeline_execution_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipeline_exec_logs_created_idx" ON "pipeline_execution_logs" USING btree ("created_at");