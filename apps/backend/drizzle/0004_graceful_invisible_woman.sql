CREATE TABLE "project_group_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"role" varchar(50) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_group_permissions_unique" UNIQUE("project_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "project_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(50) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_permissions_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_group_permissions_project_idx" ON "project_group_permissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_group_permissions_group_idx" ON "project_group_permissions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "project_permissions_project_idx" ON "project_permissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_permissions_user_idx" ON "project_permissions" USING btree ("user_id");