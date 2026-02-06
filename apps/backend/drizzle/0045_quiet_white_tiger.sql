CREATE TABLE "path_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_mapping_id" uuid NOT NULL,
	"source_path" varchar(500) NOT NULL,
	"target_path" varchar(500) NOT NULL,
	"redirect_type" varchar(10) DEFAULT '301' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" varchar(10) DEFAULT '100' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_mappings" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "redirect_target" varchar(255);--> statement-breakpoint
ALTER TABLE "path_redirects" ADD CONSTRAINT "path_redirects_domain_mapping_id_domain_mappings_id_fk" FOREIGN KEY ("domain_mapping_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_redirects" ADD CONSTRAINT "path_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_redirects_domain_mapping_id_idx" ON "path_redirects" USING btree ("domain_mapping_id");--> statement-breakpoint
CREATE INDEX "path_redirects_source_path_idx" ON "path_redirects" USING btree ("source_path");