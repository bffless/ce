ALTER TABLE "assets" ADD COLUMN "asset_type" varchar(20) DEFAULT 'commits' NOT NULL;--> statement-breakpoint
CREATE INDEX "assets_project_type_idx" ON "assets" USING btree ("project_id","asset_type");