import { PartialType } from '@nestjs/swagger';
import { CreateCacheRuleDto } from './create-cache-rule.dto';

export class UpdateCacheRuleDto extends PartialType(CreateCacheRuleDto) {}
