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
ALTER TABLE "ssl_renewal_history" ADD CONSTRAINT "ssl_renewal_history_domain_id_domain_mappings_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssl_renewal_history_domain_id_idx" ON "ssl_renewal_history" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "ssl_renewal_history_created_at_idx" ON "ssl_renewal_history" USING btree ("created_at");