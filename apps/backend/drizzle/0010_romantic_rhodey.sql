CREATE TABLE "domain_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"alias" varchar(255),
	"path" varchar(500),
	"domain" varchar(255) NOT NULL,
	"domain_type" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ssl_enabled" boolean DEFAULT false NOT NULL,
	"ssl_expires_at" timestamp,
	"dns_verified" boolean DEFAULT false NOT NULL,
	"dns_verified_at" timestamp,
	"nginx_config_path" varchar(500),
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_mappings_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_mappings_project_id_idx" ON "domain_mappings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domain_mappings_domain_idx" ON "domain_mappings" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_mappings_is_active_idx" ON "domain_mappings" USING btree ("is_active");