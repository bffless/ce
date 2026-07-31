CREATE TABLE "installed_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"version" varchar(50) NOT NULL,
	"project_id" uuid NOT NULL,
	"alias" varchar(100) NOT NULL,
	"domain_id" uuid,
	"deployment_id" uuid,
	"rule_set_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bundle_sha256" varchar(64) NOT NULL,
	"manifest" jsonb NOT NULL,
	"manual_steps_acked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'installing' NOT NULL,
	"created_resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "installed_apps_app_project_unique" UNIQUE("app_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "installed_apps" ADD CONSTRAINT "installed_apps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installed_apps" ADD CONSTRAINT "installed_apps_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installed_apps_project_id_idx" ON "installed_apps" USING btree ("project_id");