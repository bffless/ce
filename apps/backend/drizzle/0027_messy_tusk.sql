ALTER TABLE "assets" ADD COLUMN "committed_at" timestamp;--> statement-breakpoint
CREATE INDEX "assets_project_committed_at_idx" ON "assets" USING btree ("project_id","committed_at");