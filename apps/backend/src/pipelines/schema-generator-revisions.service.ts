import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ProxyRulesService } from '../proxy-rules/proxy-rules.service';
import { ProxyRuleSetRevisionsService } from '../proxy-rules/proxy-rule-set-revisions.service';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import type { RevisionTrigger } from '../db/schema/proxy-rule-set-revisions.schema';

/**
 * Revision capture for the schema-generator services (state/chat/upload).
 *
 * The generators insert rule sets and rules straight through `db` rather than
 * going via `ProxyRulesService`, so they have to run the same capture pattern
 * its rule-level mutations do: back-fill the pre-write state of a set that has
 * no revisions yet, then capture the post-write state. Without the post-write
 * capture, a default `bffless rules rollback` right after a generator adds
 * rules to an already-revisioned set restores a revision that predates them
 * and (with prune) deletes the generated rules.
 *
 * Both calls are best-effort: a revision failure must never fail generation,
 * so nothing here throws.
 */
@Injectable()
export class SchemaGeneratorRevisionsService {
  private readonly logger = new Logger(SchemaGeneratorRevisionsService.name);

  constructor(
    @Inject(forwardRef(() => ProxyRulesService))
    private readonly proxyRulesService: ProxyRulesService,
    @Inject(forwardRef(() => ProxyRuleSetRevisionsService))
    private readonly revisionsService: ProxyRuleSetRevisionsService,
  ) {}

  /**
   * Pre-write backfill. No-ops for a rule set the generator just created (no
   * rules yet) and for a set that already has revision history.
   */
  async backfill(ruleSet: ProxyRuleSet, userId?: string): Promise<void> {
    try {
      const rules = await this.proxyRulesService.getRulesByRuleSetId(ruleSet.id);
      await this.revisionsService.captureIfUnrevisioned({ ruleSet, rules, userId });
    } catch (error) {
      this.logger.warn(
        `Failed to backfill pre-generate revision for rule set ${ruleSet.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Post-write capture of the generated state. */
  async capture(ruleSet: ProxyRuleSet, trigger: RevisionTrigger, userId?: string): Promise<void> {
    try {
      const rules = await this.proxyRulesService.getRulesByRuleSetId(ruleSet.id);
      await this.revisionsService.capture({ ruleSet, rules, trigger, userId });
    } catch (error) {
      this.logger.warn(
        `Failed to capture ${trigger} revision for rule set ${ruleSet.id}: ${(error as Error).message}`,
      );
    }
  }
}
