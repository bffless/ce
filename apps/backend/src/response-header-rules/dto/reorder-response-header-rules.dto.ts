import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReorderResponseHeaderRulesDto {
  @ApiProperty({
    description: 'Ordered array of rule IDs. Index becomes the new priority.',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ruleIds: string[];
}
