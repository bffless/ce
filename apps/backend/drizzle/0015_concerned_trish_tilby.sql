CREATE TABLE "proxy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"alias_id" uuid,
	"path_pattern" varchar(500) NOT NULL,
	"target_url" text NOT NULL,
	"strip_prefix" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"timeout" integer DEFAULT 30000 NOT NULL,
	"preserve_host" boolean DEFAULT false NOT NULL,
	"header_config" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proxy_rules_scope_check" CHECK ((project_id IS NOT NULL AND alias_id IS NULL) OR (project_id IS NULL AND alias_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD CONSTRAINT "proxy_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD CONSTRAINT "proxy_rules_alias_id_deployment_aliases_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."deployment_aliases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rules_project_path_unique" ON "proxy_rules" USING btree ("project_id","path_pattern") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rules_alias_path_unique" ON "proxy_rules" USING btree ("alias_id","path_pattern") WHERE alias_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "proxy_rules_project_id_idx" ON "proxy_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proxy_rules_alias_id_idx" ON "proxy_rules" USING btree ("alias_id");--> statement-breakpoint
CREATE INDEX "proxy_rules_project_order_idx" ON "proxy_rules" USING btree ("project_id","order");--> statement-breakpoint
CREATE INDEX "proxy_rules_alias_order_idx" ON "proxy_rules" USING btree ("alias_id","order");