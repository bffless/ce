import { PartialType } from '@nestjs/swagger';
import { CreateOnboardingRuleDto } from './create-onboarding-rule.dto';

export class UpdateOnboardingRuleDto extends PartialType(CreateOnboardingRuleDto) {}
