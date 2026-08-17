CREATE TABLE "ffmpeg_executor_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_enabled" boolean DEFAULT true NOT NULL,
	"remote_enabled" boolean DEFAULT false NOT NULL,
	"remote_url" text,
	"remote_auth" varchar(32) DEFAULT 'google_id_token' NOT NULL,
	"sa_key_encrypted" text,
	"default_executor" varchar(16) DEFAULT 'local' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
