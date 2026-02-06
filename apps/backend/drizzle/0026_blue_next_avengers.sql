CREATE TABLE "path_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"filepath" varchar(1024) NOT NULL,
	"spa_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "path_preferences_project_filepath_unique" UNIQUE("project_id","filepath")
);
--> statement-breakpoint
ALTER TABLE "path_preferences" ADD CONSTRAINT "path_preferences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_path_preferences_project_id" ON "path_preferences" USING btree ("project_id");