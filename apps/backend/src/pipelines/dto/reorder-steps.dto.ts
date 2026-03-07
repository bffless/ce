import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReorderStepsDto {
  @ApiProperty({
    description: 'Step IDs in the desired order',
    type: [String],
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  stepIds: string[];
}
