CREATE TABLE "onboarding_rule_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"rule_name" varchar(100) NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"details" jsonb,
	"error_message" varchar(1000),
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"trigger" varchar(50) DEFAULT 'user_signup' NOT NULL,
	"actions" jsonb NOT NULL,
	"conditions" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_rule_executions" ADD CONSTRAINT "onboarding_rule_executions_rule_id_onboarding_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."onboarding_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_rule_executions" ADD CONSTRAINT "onboarding_rule_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_rules" ADD CONSTRAINT "onboarding_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_rule_executions_user_idx" ON "onboarding_rule_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onboarding_rule_executions_rule_idx" ON "onboarding_rule_executions" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "onboarding_rule_executions_executed_at_idx" ON "onboarding_rule_executions" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "onboarding_rule_executions_status_idx" ON "onboarding_rule_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "onboarding_rules_enabled_trigger_idx" ON "onboarding_rules" USING btree ("enabled","trigger");--> statement-breakpoint
CREATE INDEX "onboarding_rules_priority_idx" ON "onboarding_rules" USING btree ("priority");