CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"original_path" text,
	"storage_key" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"project_id" uuid NOT NULL,
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
	"public_path" text,
	"asset_type" varchar(20) DEFAULT 'commits' NOT NULL,
	"committed_at" timestamp,
	"content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "deployment_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repository" varchar(255) NOT NULL,
	"alias" varchar(100) NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"deployment_id" uuid NOT NULL,
	"is_public" boolean,
	"unauthorized_behavior" varchar(20),
	"required_role" varchar(20),
	"is_auto_preview" boolean DEFAULT false NOT NULL,
	"base_path" varchar(512),
	"proxy_rule_set_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"alias" varchar(255),
	"path" varchar(500),
	"domain" varchar(255) NOT NULL,
	"domain_type" varchar(20) NOT NULL,
	"redirect_target" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean,
	"unauthorized_behavior" varchar(20),
	"required_role" varchar(20),
	"ssl_enabled" boolean DEFAULT false NOT NULL,
	"ssl_expires_at" timestamp,
	"dns_verified" boolean DEFAULT false NOT NULL,
	"dns_verified_at" timestamp,
	"nginx_config_path" varchar(500),
	"auto_renew_ssl" boolean DEFAULT true NOT NULL,
	"ssl_renewed_at" timestamp,
	"ssl_renewal_status" varchar(20),
	"ssl_renewal_error" text,
	"sticky_sessions_enabled" boolean DEFAULT true NOT NULL,
	"sticky_session_duration" integer DEFAULT 86400 NOT NULL,
	"is_spa" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"www_behavior" varchar(20),
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_mappings_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
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
CREATE TABLE "domain_traffic_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"condition_type" varchar(20) NOT NULL,
	"condition_key" varchar(255) NOT NULL,
	"condition_value" varchar(500) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"label" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_traffic_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"alias" varchar(255) NOT NULL,
	"weight" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_traffic_weights_domain_alias_unique" UNIQUE("domain_id","alias")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"value_type" varchar(20) DEFAULT 'boolean' NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
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
CREATE TABLE "primary_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"project_id" uuid,
	"alias" varchar(255),
	"path" varchar(500),
	"www_enabled" boolean DEFAULT true NOT NULL,
	"www_behavior" varchar(50) DEFAULT 'redirect-to-www' NOT NULL,
	"is_spa" boolean DEFAULT false NOT NULL,
	"configured_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"unauthorized_behavior" varchar(20) DEFAULT 'not_found' NOT NULL,
	"required_role" varchar(20) DEFAULT 'authenticated' NOT NULL,
	"settings" jsonb,
	"default_proxy_rule_set_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "proxy_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"environment" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"path_pattern" varchar(500) NOT NULL,
	"target_url" text NOT NULL,
	"strip_prefix" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"timeout" integer DEFAULT 30000 NOT NULL,
	"preserve_host" boolean DEFAULT false NOT NULL,
	"forward_cookies" boolean DEFAULT false NOT NULL,
	"header_config" jsonb,
	"auth_transform" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" uuid,
	"commit_sha" varchar(40) NOT NULL,
	"branch" varchar(255),
	"asset_count" integer NOT NULL,
	"freed_bytes" bigint NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"branch_pattern" varchar(255) NOT NULL,
	"exclude_branches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer NOT NULL,
	"keep_with_alias" boolean DEFAULT true NOT NULL,
	"keep_minimum" integer DEFAULT 0 NOT NULL,
	"path_patterns" jsonb,
	"path_mode" varchar(10),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"execution_started_at" timestamp,
	"last_run_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"domain_mapping_id" uuid,
	"token" varchar(64) NOT NULL,
	"label" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ssl_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_domain" varchar(255) NOT NULL,
	"challenge_type" varchar(20) NOT NULL,
	"record_name" varchar(255) NOT NULL,
	"record_value" text NOT NULL,
	"token" varchar(255) NOT NULL,
	"order_data" text NOT NULL,
	"authz_data" text NOT NULL,
	"key_authorization" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ssl_challenges_base_domain_unique" UNIQUE("base_domain")
);
--> statement-breakpoint
CREATE TABLE "ssl_renewal_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid,
	"certificate_type" varchar(20) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"previous_expires_at" timestamp,
	"new_expires_at" timestamp,
	"triggered_by" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssl_settings" (
	"key" varchar(50) PRIMARY KEY NOT NULL,
	"value" varchar(255) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_setup_complete" boolean DEFAULT false NOT NULL,
	"storage_provider" varchar(50),
	"storage_config" text,
	"email_provider" varchar(50),
	"email_config" text,
	"email_configured" boolean DEFAULT false NOT NULL,
	"smtp_config" text,
	"smtp_configured" boolean DEFAULT false NOT NULL,
	"cache_config" text,
	"jwt_secret" text,
	"api_key_salt" text,
	"allow_public_signups" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_members_unique" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp,
	"disabled_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"token" varchar(255) NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cache_rules" ADD CONSTRAINT "cache_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD CONSTRAINT "deployment_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD CONSTRAINT "deployment_aliases_proxy_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("proxy_rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_redirects" ADD CONSTRAINT "domain_redirects_target_domain_id_domain_mappings_id_fk" FOREIGN KEY ("target_domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_redirects" ADD CONSTRAINT "domain_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_traffic_rules" ADD CONSTRAINT "domain_traffic_rules_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_traffic_weights" ADD CONSTRAINT "domain_traffic_weights_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_preferences" ADD CONSTRAINT "path_preferences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_redirects" ADD CONSTRAINT "path_redirects_domain_mapping_id_domain_mappings_id_fk" FOREIGN KEY ("domain_mapping_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_redirects" ADD CONSTRAINT "path_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_content" ADD CONSTRAINT "primary_content_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_content" ADD CONSTRAINT "primary_content_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_permissions" ADD CONSTRAINT "project_group_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_rule_sets" ADD CONSTRAINT "proxy_rule_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD CONSTRAINT "proxy_rules_rule_set_id_proxy_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."proxy_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_logs" ADD CONSTRAINT "retention_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_logs" ADD CONSTRAINT "retention_logs_rule_id_retention_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."retention_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rules" ADD CONSTRAINT "retention_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_domain_mapping_id_domain_mappings_id_fk" FOREIGN KEY ("domain_mapping_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_renewal_history" ADD CONSTRAINT "ssl_renewal_history_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_project_id_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assets_project_id_idx" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assets_project_type_idx" ON "assets" USING btree ("project_id","asset_type");--> statement-breakpoint
CREATE INDEX "assets_project_commit_path_idx" ON "assets" USING btree ("project_id","commit_sha","public_path");--> statement-breakpoint
CREATE INDEX "assets_project_branch_idx" ON "assets" USING btree ("project_id","branch");--> statement-breakpoint
CREATE INDEX "assets_project_commit_idx" ON "assets" USING btree ("project_id","commit_sha");--> statement-breakpoint
CREATE INDEX "assets_project_created_at_idx" ON "assets" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "assets_project_committed_at_idx" ON "assets" USING btree ("project_id","committed_at");--> statement-breakpoint
CREATE INDEX "assets_deployment_path_idx" ON "assets" USING btree ("deployment_id","public_path");--> statement-breakpoint
CREATE INDEX "assets_deployment_id_idx" ON "assets" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "assets_deployment_size_idx" ON "assets" USING btree ("deployment_id","size");--> statement-breakpoint
CREATE UNIQUE INDEX "cache_rules_project_pattern_unique" ON "cache_rules" USING btree ("project_id","path_pattern");--> statement-breakpoint
CREATE INDEX "cache_rules_project_id_idx" ON "cache_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cache_rules_project_priority_idx" ON "cache_rules" USING btree ("project_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_aliases_project_alias_unique" ON "deployment_aliases" USING btree ("project_id","alias");--> statement-breakpoint
CREATE INDEX "deployment_aliases_project_id_idx" ON "deployment_aliases" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_aliases_repository_alias_unique" ON "deployment_aliases" USING btree ("repository","alias");--> statement-breakpoint
CREATE INDEX "deployment_aliases_repository_idx" ON "deployment_aliases" USING btree ("repository");--> statement-breakpoint
CREATE INDEX "deployment_aliases_commit_sha_idx" ON "deployment_aliases" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX "deployment_aliases_deployment_id_idx" ON "deployment_aliases" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "domain_mappings_project_id_idx" ON "domain_mappings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domain_mappings_domain_idx" ON "domain_mappings" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_mappings_is_active_idx" ON "domain_mappings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "domain_redirects_target_domain_id_idx" ON "domain_redirects" USING btree ("target_domain_id");--> statement-breakpoint
CREATE INDEX "domain_redirects_source_domain_idx" ON "domain_redirects" USING btree ("source_domain");--> statement-breakpoint
CREATE INDEX "domain_traffic_rules_domain_id_idx" ON "domain_traffic_rules" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "domain_traffic_rules_domain_id_priority_idx" ON "domain_traffic_rules" USING btree ("domain_id","priority");--> statement-breakpoint
CREATE INDEX "domain_traffic_weights_domain_id_idx" ON "domain_traffic_weights" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "feature_flags_key_idx" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_path_preferences_project_id" ON "path_preferences" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "path_redirects_domain_mapping_id_idx" ON "path_redirects" USING btree ("domain_mapping_id");--> statement-breakpoint
CREATE INDEX "path_redirects_source_path_idx" ON "path_redirects" USING btree ("source_path");--> statement-breakpoint
CREATE INDEX "project_group_permissions_project_idx" ON "project_group_permissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_group_permissions_group_idx" ON "project_group_permissions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "project_permissions_project_idx" ON "project_permissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_permissions_user_idx" ON "project_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "projects" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "projects_updated_at_idx" ON "projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rule_sets_project_name_unique" ON "proxy_rule_sets" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "proxy_rule_sets_project_id_idx" ON "proxy_rule_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proxy_rule_sets_environment_idx" ON "proxy_rule_sets" USING btree ("project_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rules_rule_set_path_unique" ON "proxy_rules" USING btree ("rule_set_id","path_pattern");--> statement-breakpoint
CREATE INDEX "proxy_rules_rule_set_id_idx" ON "proxy_rules" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX "proxy_rules_rule_set_order_idx" ON "proxy_rules" USING btree ("rule_set_id","order");--> statement-breakpoint
CREATE INDEX "retention_logs_project_id_idx" ON "retention_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "retention_logs_rule_id_idx" ON "retention_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "retention_logs_deleted_at_idx" ON "retention_logs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "retention_logs_project_deleted_at_idx" ON "retention_logs" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "retention_rules_project_id_idx" ON "retention_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "retention_rules_next_run_idx" ON "retention_rules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "retention_rules_enabled_next_run_idx" ON "retention_rules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "share_links_project_id_idx" ON "share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "share_links_domain_mapping_id_idx" ON "share_links" USING btree ("domain_mapping_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_idx" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "share_links_is_active_idx" ON "share_links" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ssl_challenges_base_domain_idx" ON "ssl_challenges" USING btree ("base_domain");--> statement-breakpoint
CREATE INDEX "ssl_challenges_status_idx" ON "ssl_challenges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ssl_renewal_history_domain_id_idx" ON "ssl_renewal_history" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "ssl_renewal_history_created_at_idx" ON "ssl_renewal_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_group_members_group_idx" ON "user_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "user_group_members_user_idx" ON "user_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_groups_created_by_idx" ON "user_groups" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_workspace_invitations_email" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_workspace_invitations_token" ON "workspace_invitations" USING btree ("token");