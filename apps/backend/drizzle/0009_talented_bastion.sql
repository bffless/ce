CREATE INDEX "projects_updated_at_idx" ON "projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "projects_search_idx" ON "projects" USING gin(to_tsvector('english', owner || ' ' || name || ' ' || COALESCE(description, '')));