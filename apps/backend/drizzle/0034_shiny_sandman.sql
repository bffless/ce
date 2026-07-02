CREATE TABLE "traffic_ip_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" varchar(45) NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"sample_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_user_agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp NOT NULL,
	"ip" varchar(45) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" text NOT NULL,
	"http_version" varchar(16) NOT NULL,
	"status" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"referer" text,
	"user_agent" text,
	"host" varchar(255),
	"classification" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_ip_rollups_ip_unique" ON "traffic_ip_rollups" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "traffic_ip_rollups_request_count_idx" ON "traffic_ip_rollups" USING btree ("request_count");--> statement-breakpoint
CREATE INDEX "traffic_ip_rollups_last_seen_idx" ON "traffic_ip_rollups" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "traffic_requests_timestamp_idx" ON "traffic_requests" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "traffic_requests_ip_idx" ON "traffic_requests" USING btree ("ip","timestamp");--> statement-breakpoint
CREATE INDEX "traffic_requests_status_idx" ON "traffic_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "traffic_requests_classification_idx" ON "traffic_requests" USING btree ("classification");