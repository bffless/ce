CREATE TABLE "response_header_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path_pattern" varchar(500) NOT NULL,
	"frame_policy" varchar(20) DEFAULT 'sameorigin' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb,
	"custom_headers" jsonb,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"name" varchar(100),
	"description" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_header_rules" ADD CONSTRAINT "response_header_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "response_header_rules_project_pattern_unique" ON "response_header_rules" USING btree ("project_id","path_pattern");--> statement-breakpoint
CREATE INDEX "response_header_rules_project_id_idx" ON "response_header_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "response_header_rules_project_priority_idx" ON "response_header_rules" USING btree ("project_id","priority");