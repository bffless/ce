ALTER TABLE "deployment_aliases" ADD COLUMN "unauthorized_behavior" varchar(20);--> statement-breakpoint
ALTER TABLE "deployment_aliases" ADD COLUMN "required_role" varchar(20);--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "unauthorized_behavior" varchar(20);--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN "required_role" varchar(20);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "unauthorized_behavior" varchar(20) DEFAULT 'not_found' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "required_role" varchar(20) DEFAULT 'authenticated' NOT NULL;