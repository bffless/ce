CREATE TABLE "pending_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_token" varchar(64) NOT NULL,
	"project_id" uuid,
	"repository" varchar(255) NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"branch" varchar(255),
	"alias" varchar(100),
	"base_path" varchar(512),
	"description" text,
	"tags" jsonb,
	"proxy_rule_set_id" uuid,
	"files" jsonb NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "pending_uploads_upload_token_unique" UNIQUE("upload_token")
);
--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_proxy_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("proxy_rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_uploads_token_idx" ON "pending_uploads" USING btree ("upload_token");--> statement-breakpoint
CREATE INDEX "pending_uploads_expires_idx" ON "pending_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_uploads_project_idx" ON "pending_uploads" USING btree ("project_id");