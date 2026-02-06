import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { domainMappings, domainTrafficRules } from '../db/schema';
import { CreateTrafficRuleDto } from './dto/traffic-rule.dto';
import { UpdateTrafficRuleDto } from './dto/traffic-rule.dto';

@Injectable()
export class TrafficRulesService {
  private readonly logger = new Logger(TrafficRulesService.name);

  /**
   * Create a traffic rule for a domain mapping.
   */
  async create(domainId: string, dto: CreateTrafficRuleDto, _userId: string) {
    // Verify domain mapping exists
    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainId))
      .limit(1);

    if (!domain) {
      throw new NotFoundException('Domain mapping not found');
    }

    const [rule] = await db
      .insert(domainTrafficRules)
      .values({
        domainId,
        alias: dto.alias,
        conditionType: dto.conditionType,
        conditionKey: dto.conditionKey,
        conditionValue: dto.conditionValue,
        priority: dto.priority ?? 100,
        label: dto.label ?? null,
      })
      .returning();

    this.logger.log(
      `Created traffic rule: ${dto.conditionType}[${dto.conditionKey}]=${dto.conditionValue} → ${dto.alias} for domain ${domain.domain}`,
    );

    return rule;
  }

  /**
   * Get all traffic rules for a domain mapping, ordered by priority.
   */
  async findByDomain(domainId: string, _userId: string) {
    return db
      .select()
      .from(domainTrafficRules)
      .where(eq(domainTrafficRules.domainId, domainId))
      .orderBy(asc(domainTrafficRules.priority));
  }

  /**
   * Update a traffic rule.
   */
  async update(ruleId: string, dto: UpdateTrafficRuleDto, _userId: string) {
    const [existing] = await db
      .select()
      .from(domainTrafficRules)
      .where(eq(domainTrafficRules.id, ruleId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Traffic rule with ID ${ruleId} not found`);
    }

    const [updated] = await db
      .update(domainTrafficRules)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(domainTrafficRules.id, ruleId))
      .returning();

    return updated;
  }

  /**
   * Delete a traffic rule.
   */
  async remove(ruleId: string, _userId: string) {
    const [existing] = await db
      .select()
      .from(domainTrafficRules)
      .where(eq(domainTrafficRules.id, ruleId))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Traffic rule with ID ${ruleId} not found`);
    }

    await db.delete(domainTrafficRules).where(eq(domainTrafficRules.id, ruleId));

    this.logger.log(`Deleted traffic rule ${ruleId}`);

    return { success: true };
  }

  /**
   * Evaluate traffic rules for a domain against incoming request conditions.
   * Returns the alias of the first matching rule, or null if no rules match.
   */
  async evaluateRules(
    domainId: string,
    queryParams: Record<string, string> | undefined,
    cookies: Record<string, string> | undefined,
  ): Promise<string | null> {
    const rules = await db
      .select()
      .from(domainTrafficRules)
      .where(eq(domainTrafficRules.domainId, domainId))
      .orderBy(asc(domainTrafficRules.priority));

    for (const rule of rules) {
      if (!rule.isActive) continue;

      let match = false;

      if (rule.conditionType === 'query_param') {
        match = queryParams?.[rule.conditionKey] === rule.conditionValue;
      } else if (rule.conditionType === 'cookie') {
        match = cookies?.[rule.conditionKey] === rule.conditionValue;
      }

      if (match) {
        return rule.alias;
      }
    }

    return null;
  }

  /**
   * Check if an alias is referenced by any active traffic rule for a domain.
   * Used by sticky session validation to honor cookies set by rule matches
   * on prior requests (e.g., the HTML page had ?token=X, but asset requests don't).
   */
  async isRuleAlias(domainId: string, alias: string): Promise<boolean> {
    const [match] = await db
      .select({ id: domainTrafficRules.id })
      .from(domainTrafficRules)
      .where(
        and(
          eq(domainTrafficRules.domainId, domainId),
          eq(domainTrafficRules.alias, alias),
          eq(domainTrafficRules.isActive, true),
        ),
      )
      .limit(1);

    return !!match;
  }
}
