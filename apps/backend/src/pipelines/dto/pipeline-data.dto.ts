import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsNotEmpty } from 'class-validator';

/**
 * DTO for creating a data record
 */
export class CreatePipelineDataDto {
  @ApiProperty({
    description: 'The data object to store',
    example: { name: 'John Doe', email: 'john@example.com' },
  })
  @IsObject()
  @IsNotEmpty()
  data: Record<string, unknown>;
}

/**
 * DTO for updating a data record
 */
export class UpdatePipelineDataDto {
  @ApiProperty({
    description: 'The updated data object',
    example: { name: 'Jane Doe', email: 'jane@example.com' },
  })
  @IsObject()
  @IsNotEmpty()
  data: Record<string, unknown>;
}
