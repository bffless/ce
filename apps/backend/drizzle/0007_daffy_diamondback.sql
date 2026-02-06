-- Phase 3H: Add projectId to deployment_aliases
-- Step 1: Add column as nullable
ALTER TABLE "deployment_aliases" ADD COLUMN "project_id" uuid;--> statement-breakpoint

-- Step 2: Populate projectId from repository field
UPDATE "deployment_aliases" AS da
SET "project_id" = p.id
FROM projects p
WHERE da.repository = (p.owner || '/' || p.name);--> statement-breakpoint

-- Step 3: Make column NOT NULL
ALTER TABLE "deployment_aliases" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint

-- Step 4: Add foreign key constraint
ALTER TABLE "deployment_aliases" ADD CONSTRAINT "deployment_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Step 5: Create indexes
CREATE UNIQUE INDEX "deployment_aliases_project_alias_unique" ON "deployment_aliases" USING btree ("project_id","alias");--> statement-breakpoint
CREATE INDEX "deployment_aliases_project_id_idx" ON "deployment_aliases" USING btree ("project_id");