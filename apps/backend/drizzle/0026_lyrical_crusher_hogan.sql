CREATE TABLE "oidc_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"config_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"source" varchar(16) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_providers_provider_id_unique" ON "oidc_providers" USING btree ("provider_id");