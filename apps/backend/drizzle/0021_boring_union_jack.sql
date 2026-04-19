CREATE TABLE "project_invite_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"role" varchar(50) DEFAULT 'guest' NOT NULL,
	"label" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "project_invite_links" ADD CONSTRAINT "project_invite_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invite_links" ADD CONSTRAINT "project_invite_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_invite_links_project_id_idx" ON "project_invite_links" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_invite_links_token_idx" ON "project_invite_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "project_invite_links_is_active_idx" ON "project_invite_links" USING btree ("is_active");