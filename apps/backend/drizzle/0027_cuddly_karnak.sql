CREATE TABLE "google_integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" varchar(32) NOT NULL,
	"config_encrypted" text NOT NULL,
	"configured" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "google_integration_credentials_service_unique" ON "google_integration_credentials" USING btree ("service");