CREATE TABLE "cache_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path_pattern" varchar(500) NOT NULL,
	"browser_max_age" integer DEFAULT 300 NOT NULL,
	"cdn_max_age" integer,
	"stale_while_revalidate" integer,
	"immutable" boolean DEFAULT false NOT NULL,
	"cacheability" varchar(10),
	"priority" integer DEFAULT 100 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"name" varchar(100),
	"description" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cache_rules" ADD CONSTRAINT "cache_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cache_rules_project_pattern_unique" ON "cache_rules" USING btree ("project_id","path_pattern");--> statement-breakpoint
CREATE INDEX "cache_rules_project_id_idx" ON "cache_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cache_rules_project_priority_idx" ON "cache_rules" USING btree ("project_id","priority");