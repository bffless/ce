DROP INDEX "proxy_rules_rule_set_path_unique";--> statement-breakpoint
ALTER TABLE "proxy_rules" ADD COLUMN "method" varchar(10);--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_rules_rule_set_path_method_unique" ON "proxy_rules" USING btree ("rule_set_id","path_pattern","method");