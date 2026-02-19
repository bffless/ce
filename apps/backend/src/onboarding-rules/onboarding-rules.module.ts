import { Module } from '@nestjs/common';
import { OnboardingRulesController } from './onboarding-rules.controller';
import { OnboardingRulesService } from './onboarding-rules.service';
import { OnboardingExecutorService } from './onboarding-executor.service';

@Module({
  controllers: [OnboardingRulesController],
  providers: [OnboardingRulesService, OnboardingExecutorService],
  exports: [OnboardingRulesService, OnboardingExecutorService],
})
export class OnboardingRulesModule {}
