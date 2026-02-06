import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReorderCacheRulesDto {
  @ApiProperty({
    description: 'Ordered array of rule IDs. The index determines the new priority.',
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ruleIds: string[];
}
