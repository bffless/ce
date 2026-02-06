CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"allowed_repositories" text,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"original_path" text,
	"storage_key" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"repository" varchar(255),
	"branch" varchar(255),
	"commit_sha" varchar(40),
	"workflow_name" varchar(255),
	"workflow_run_id" varchar(50),
	"workflow_run_number" integer,
	"uploaded_by" uuid,
	"organization_id" uuid,
	"tags" text,
	"description" text,
	"deployment_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployment_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository" varchar(255) NOT NULL,
	"alias" varchar(100) NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"deployment_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_setup_complete" boolean DEFAULT false NOT NULL,
	"storage_provider" varchar(50),
	"storage_config" text,
	"jwt_secret" text,
	"api_key_salt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repo_commit_path_idx" ON "assets" USING btree ("repository","commit_sha","public_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_deployment_path_idx" ON "assets" USING btree ("deployment_id","public_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repo_public_idx" ON "assets" USING btree ("repository","is_public");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repository_idx" ON "assets" USING btree ("repository");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_deployment_id_idx" ON "assets" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repo_branch_idx" ON "assets" USING btree ("repository","branch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repo_commit_idx" ON "assets" USING btree ("repository","commit_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_repo_created_at_idx" ON "assets" USING btree ("repository","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_deployment_size_idx" ON "assets" USING btree ("deployment_id","size");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deployment_aliases_repository_alias_unique" ON "deployment_aliases" USING btree ("repository","alias");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_aliases_repository_idx" ON "deployment_aliases" USING btree ("repository");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_aliases_commit_sha_idx" ON "deployment_aliases" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployment_aliases_deployment_id_idx" ON "deployment_aliases" USING btree ("deployment_id");