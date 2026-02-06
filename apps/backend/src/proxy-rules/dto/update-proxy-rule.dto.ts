import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProxyRuleDto } from './create-proxy-rule.dto';

// Cannot change ruleSetId after creation
export class UpdateProxyRuleDto extends PartialType(
  OmitType(CreateProxyRuleDto, ['ruleSetId'] as const),
) {}
