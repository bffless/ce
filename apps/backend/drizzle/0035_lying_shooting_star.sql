CREATE TABLE "blocklist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocklist_id" uuid NOT NULL,
	"kind" varchar(10) DEFAULT 'block' NOT NULL,
	"match_type" varchar(20) DEFAULT 'prefix' NOT NULL,
	"value" varchar(512) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocklist_entries" ADD CONSTRAINT "blocklist_entries_blocklist_id_blocklists_id_fk" FOREIGN KEY ("blocklist_id") REFERENCES "public"."blocklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocklist_entries_blocklist_id_idx" ON "blocklist_entries" USING btree ("blocklist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklist_entries_unique" ON "blocklist_entries" USING btree ("blocklist_id","kind","match_type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklists_name_unique" ON "blocklists" USING btree ("name");