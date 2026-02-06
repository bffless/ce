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
CREATE INDEX "ssl_challenges_base_domain_idx" ON "ssl_challenges" USING btree ("base_domain");--> statement-breakpoint
CREATE INDEX "ssl_challenges_status_idx" ON "ssl_challenges" USING btree ("status");