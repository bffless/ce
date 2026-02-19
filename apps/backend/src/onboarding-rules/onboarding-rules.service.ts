import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, asc, and, desc } from 'drizzle-orm';
import { db } from '../db/client';
import {
  onboardingRules,
  OnboardingRule,
  NewOnboardingRule,
  OnboardingTrigger,
  OnboardingAction,
  OnboardingCondition,
} from '../db/schema/onboarding-rules.schema';
import {
  onboardingRuleExecutions,
  OnboardingRuleExecution,
} from '../db/schema/onboarding-rule-executions.schema';
import { CreateOnboardingRuleDto, UpdateOnboardingRuleDto } from './dto';

@Injectable()
export class OnboardingRulesService {
  private readonly logger = new Logger(OnboardingRulesService.name);

  /**
   * Get all onboarding rules, ordered by priority
   */
  async getAllRules(): Promise<OnboardingRule[]> {
    return db
      .select()
      .from(onboardingRules)
      .orderBy(asc(onboardingRules.priority), asc(onboardingRules.createdAt));
  }

  /**
   * Get enabled rules for a specific trigger, ordered by priority
   */
  async getEnabledRulesByTrigger(trigger: OnboardingTrigger): Promise<OnboardingRule[]> {
    return db
      .select()
      .from(onboardingRules)
      .where(
        and(
          eq(onboardingRules.enabled, true),
          eq(onboardingRules.trigger, trigger),
        ),
      )
      .orderBy(asc(onboardingRules.priority), asc(onboardingRules.createdAt));
  }

  /**
   * Get a single rule by ID
   */
  async getRuleById(id: string): Promise<OnboardingRule | null> {
    const [rule] = await db
      .select()
      .from(onboardingRules)
      .where(eq(onboardingRules.id, id))
      .limit(1);
    return rule || null;
  }

  /**
   * Create a new onboarding rule
   */
  async create(dto: CreateOnboardingRuleDto, userId: string): Promise<OnboardingRule> {
    // Cast DTOs to schema types (DTOs have the same structure)
    const actions = dto.actions as OnboardingAction[];
    const conditions = dto.conditions as OnboardingCondition[] | null;

    const [rule] = await db
      .insert(onboardingRules)
      .values({
        name: dto.name,
        description: dto.description ?? null,
        trigger: dto.trigger ?? 'user_signup',
        actions,
        conditions: conditions ?? null,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 100,
        createdBy: userId,
      } satisfies NewOnboardingRule)
      .returning();

    this.logger.log(`Created onboarding rule: ${rule.name} (id: ${rule.id})`);

    return rule;
  }

  /**
   * Update an onboarding rule
   */
  async update(id: string, dto: UpdateOnboardingRuleDto): Promise<OnboardingRule> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Onboarding rule ${id} not found`);
    }

    const updateData: Partial<NewOnboardingRule> = {
      updatedAt: new Date(),
    };

    if ('name' in dto) updateData.name = dto.name;
    if ('description' in dto) updateData.description = dto.description ?? null;
    if ('trigger' in dto) updateData.trigger = dto.trigger;
    if ('actions' in dto) updateData.actions = dto.actions as OnboardingAction[] | undefined;
    if ('conditions' in dto) updateData.conditions = (dto.conditions as OnboardingCondition[] | null) ?? null;
    if ('enabled' in dto) updateData.enabled = dto.enabled;
    if ('priority' in dto) updateData.priority = dto.priority;

    const [updated] = await db
      .update(onboardingRules)
      .set(updateData)
      .where(eq(onboardingRules.id, id))
      .returning();

    this.logger.log(`Updated onboarding rule: ${updated.name} (id: ${id})`);

    return updated;
  }

  /**
   * Delete an onboarding rule
   */
  async delete(id: string): Promise<void> {
    const existing = await this.getRuleById(id);
    if (!existing) {
      throw new NotFoundException(`Onboarding rule ${id} not found`);
    }

    await db.delete(onboardingRules).where(eq(onboardingRules.id, id));

    this.logger.log(`Deleted onboarding rule: ${existing.name} (id: ${id})`);
  }

  /**
   * Get recent rule executions for audit log
   */
  async getRecentExecutions(limit: number = 50): Promise<OnboardingRuleExecution[]> {
    return db
      .select()
      .from(onboardingRuleExecutions)
      .orderBy(desc(onboardingRuleExecutions.executedAt))
      .limit(limit);
  }

  /**
   * Get executions for a specific user
   */
  async getExecutionsByUserId(userId: string): Promise<OnboardingRuleExecution[]> {
    return db
      .select()
      .from(onboardingRuleExecutions)
      .where(eq(onboardingRuleExecutions.userId, userId))
      .orderBy(desc(onboardingRuleExecutions.executedAt));
  }
}
