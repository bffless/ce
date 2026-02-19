import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  IsArray,
  IsIn,
  MaxLength,
  Min,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  OnboardingActionType,
  OnboardingActionParams,
  OnboardingTrigger,
} from '../../db/schema/onboarding-rules.schema';

export class OnboardingActionDto {
  @ApiProperty({
    description: 'Type of action to execute',
    enum: ['grant_repo_access', 'assign_role', 'add_to_group'],
    example: 'grant_repo_access',
  })
  @IsString()
  @IsIn(['grant_repo_access', 'assign_role', 'add_to_group'])
  type: OnboardingActionType;

  @ApiProperty({
    description: 'Parameters for the action (varies by type)',
    example: { repository: 'bffless/demo', role: 'viewer' },
  })
  @IsObject()
  params: OnboardingActionParams;
}

export class OnboardingConditionDto {
  @ApiProperty({
    description: 'Type of condition',
    enum: ['email_domain', 'email_pattern'],
    example: 'email_domain',
  })
  @IsString()
  @IsIn(['email_domain', 'email_pattern'])
  type: 'email_domain' | 'email_pattern';

  @ApiProperty({
    description: 'Value to match against',
    example: 'example.com',
  })
  @IsString()
  @MaxLength(255)
  value: string;
}

export class CreateOnboardingRuleDto {
  @ApiProperty({
    description: 'Human-readable name for the rule',
    example: 'Grant demo repo access',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Description explaining the rule purpose',
    example: 'Automatically grants viewer access to demo repo for all new signups',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Event that triggers this rule',
    enum: ['user_signup', 'invite_accepted'],
    default: 'user_signup',
  })
  @IsOptional()
  @IsString()
  @IsIn(['user_signup', 'invite_accepted'])
  trigger?: OnboardingTrigger;

  @ApiProperty({
    description: 'Actions to execute when rule matches',
    type: [OnboardingActionDto],
    example: [{ type: 'grant_repo_access', params: { repository: 'bffless/demo', role: 'viewer' } }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingActionDto)
  actions: OnboardingActionDto[];

  @ApiPropertyOptional({
    description: 'Conditions that must match for rule to execute',
    type: [OnboardingConditionDto],
    example: [{ type: 'email_domain', value: 'example.com' }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingConditionDto)
  conditions?: OnboardingConditionDto[] | null;

  @ApiPropertyOptional({
    description: 'Whether this rule is enabled',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Execution priority. Lower = higher priority (executed first).',
    default: 100,
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
