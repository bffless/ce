CREATE TABLE "domain_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_domain" varchar(255) NOT NULL,
	"target_domain_id" uuid NOT NULL,
	"redirect_type" varchar(10) DEFAULT '301' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ssl_enabled" boolean DEFAULT false NOT NULL,
	"nginx_config_path" varchar(500),
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_redirects_source_domain_unique" UNIQUE("source_domain")
);
--> statement-breakpoint
ALTER TABLE "domain_redirects" ADD CONSTRAINT "domain_redirects_target_domain_id_domain_mappings_id_fk" FOREIGN KEY ("target_domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_redirects" ADD CONSTRAINT "domain_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_redirects_target_domain_id_idx" ON "domain_redirects" USING btree ("target_domain_id");--> statement-breakpoint
CREATE INDEX "domain_redirects_source_domain_idx" ON "domain_redirects" USING btree ("source_domain");