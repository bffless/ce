CREATE TABLE "pipeline_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_schemas_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "pipeline_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" varchar(255),
	"handler_type" varchar(50) NOT NULL,
	"config" jsonb NOT NULL,
	"order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"path_pattern" varchar(255) NOT NULL,
	"http_methods" jsonb DEFAULT '["POST"]'::jsonb NOT NULL,
	"validators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_data" ADD CONSTRAINT "pipeline_data_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_data" ADD CONSTRAINT "pipeline_data_schema_id_pipeline_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."pipeline_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_data" ADD CONSTRAINT "pipeline_data_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_schemas" ADD CONSTRAINT "pipeline_schemas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_data_project_id_idx" ON "pipeline_data" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipeline_data_schema_id_idx" ON "pipeline_data" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "pipeline_data_created_at_idx" ON "pipeline_data" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "pipeline_schemas_project_id_idx" ON "pipeline_schemas" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_pipeline_id_idx" ON "pipeline_steps" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_order_idx" ON "pipeline_steps" USING btree ("pipeline_id","order");--> statement-breakpoint
CREATE INDEX "pipelines_project_id_idx" ON "pipelines" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipelines_path_pattern_idx" ON "pipelines" USING btree ("project_id","path_pattern");--> statement-breakpoint
CREATE INDEX "pipelines_order_idx" ON "pipelines" USING btree ("project_id","order");