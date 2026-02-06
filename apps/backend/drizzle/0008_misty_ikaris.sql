DROP INDEX "assets_repo_commit_path_idx";--> statement-breakpoint
DROP INDEX "assets_repo_public_idx";--> statement-breakpoint
DROP INDEX "assets_repository_idx";--> statement-breakpoint
DROP INDEX "assets_repo_branch_idx";--> statement-breakpoint
DROP INDEX "assets_repo_commit_idx";--> statement-breakpoint
DROP INDEX "assets_repo_created_at_idx";--> statement-breakpoint
CREATE INDEX "assets_project_commit_path_idx" ON "assets" USING btree ("project_id","commit_sha","public_path");--> statement-breakpoint
CREATE INDEX "assets_project_branch_idx" ON "assets" USING btree ("project_id","branch");--> statement-breakpoint
CREATE INDEX "assets_project_commit_idx" ON "assets" USING btree ("project_id","commit_sha");--> statement-breakpoint
CREATE INDEX "assets_project_created_at_idx" ON "assets" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "allowed_repositories";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "repository";--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "is_public";