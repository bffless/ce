ALTER TABLE "assets" ADD COLUMN "source" varchar(20) DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_uploads" ADD COLUMN "source" varchar(20) DEFAULT 'github' NOT NULL;