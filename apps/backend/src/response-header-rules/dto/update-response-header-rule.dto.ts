import { PartialType } from '@nestjs/swagger';
import { CreateResponseHeaderRuleDto } from './create-response-header-rule.dto';

export class UpdateResponseHeaderRuleDto extends PartialType(CreateResponseHeaderRuleDto) {}
