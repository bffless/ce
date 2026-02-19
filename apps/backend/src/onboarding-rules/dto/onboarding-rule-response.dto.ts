import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OnboardingAction,
  OnboardingCondition,
  OnboardingTrigger,
} from '../../db/schema/onboarding-rules.schema';
import {
  ActionExecutionResult,
  ExecutionStatus,
} from '../../db/schema/onboarding-rule-executions.schema';

export class OnboardingRuleResponseDto {
  @ApiProperty({ description: 'Rule ID' })
  id: string;

  @ApiProperty({ description: 'Human-readable name for the rule' })
  name: string;

  @ApiPropertyOptional({ description: 'Description explaining the rule purpose' })
  description: string | null;

  @ApiProperty({
    description: 'Event that triggers this rule',
    enum: ['user_signup', 'invite_accepted'],
  })
  trigger: OnboardingTrigger;

  @ApiProperty({ description: 'Actions to execute when rule matches' })
  actions: OnboardingAction[];

  @ApiPropertyOptional({ description: 'Conditions that must match for rule to execute' })
  conditions: OnboardingCondition[] | null;

  @ApiProperty({ description: 'Whether this rule is enabled' })
  enabled: boolean;

  @ApiProperty({ description: 'Execution priority (lower = higher priority)' })
  priority: number;

  @ApiPropertyOptional({ description: 'ID of user who created this rule' })
  createdBy: string | null;

  @ApiProperty({ description: 'Rule creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Rule last updated timestamp' })
  updatedAt: Date;
}

export class OnboardingRuleExecutionResponseDto {
  @ApiProperty({ description: 'Execution ID' })
  id: string;

  @ApiPropertyOptional({ description: 'Rule ID (null if rule was deleted)' })
  ruleId: string | null;

  @ApiProperty({ description: 'Rule name at time of execution' })
  ruleName: string;

  @ApiProperty({ description: 'User ID the rule was executed for' })
  userId: string;

  @ApiProperty({
    description: 'Trigger type',
    enum: ['user_signup', 'invite_accepted'],
  })
  trigger: OnboardingTrigger;

  @ApiProperty({
    description: 'Execution status',
    enum: ['success', 'partial', 'failed', 'skipped'],
  })
  status: ExecutionStatus;

  @ApiPropertyOptional({ description: 'Detailed results for each action' })
  details: ActionExecutionResult[] | null;

  @ApiPropertyOptional({ description: 'Error message if execution failed' })
  errorMessage: string | null;

  @ApiProperty({ description: 'When the execution occurred' })
  executedAt: Date;
}

export class OnboardingRuleWithStatsDto extends OnboardingRuleResponseDto {
  @ApiPropertyOptional({ description: 'Total execution count' })
  executionCount?: number;

  @ApiPropertyOptional({ description: 'Last execution timestamp' })
  lastExecutedAt?: Date | null;
}
