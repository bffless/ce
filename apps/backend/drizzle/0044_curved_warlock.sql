CREATE TABLE "remote_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"auth" varchar(32) DEFAULT 'google_id_token' NOT NULL,
	"credential_encrypted" text,
	"max_inflight" integer DEFAULT 8 NOT NULL,
	"health_path" varchar(255) DEFAULT '/health',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "remote_connections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "ffmpeg_executor_settings" ADD COLUMN "remote_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "ffmpeg_executor_settings" ADD CONSTRAINT "ffmpeg_executor_settings_remote_connection_id_remote_connections_id_fk" FOREIGN KEY ("remote_connection_id") REFERENCES "public"."remote_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "remote_connections" ("name","url","auth","credential_encrypted","health_path")
SELECT 'ffmpeg', "remote_url", "remote_auth", "sa_key_encrypted", '/health'
FROM "ffmpeg_executor_settings"
WHERE "remote_url" IS NOT NULL
ORDER BY "created_at" LIMIT 1
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "ffmpeg_executor_settings" s
SET "remote_connection_id" = c."id"
FROM "remote_connections" c
WHERE c."name" = 'ffmpeg' AND s."remote_url" IS NOT NULL AND s."remote_connection_id" IS NULL;
