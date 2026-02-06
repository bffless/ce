import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePathPreferenceDto {
  @ApiProperty({
    description: 'Whether SPA mode is enabled for this path',
    example: true,
  })
  @IsBoolean()
  spaMode: boolean;
}

export class PathPreferenceResponseDto {
  @ApiProperty({
    description: 'Preference ID (only present if persisted)',
    example: 1,
    required: false,
  })
  id?: number;

  @ApiProperty({
    description: 'Filepath within the repository',
    example: 'apps/frontend/dist',
  })
  filepath: string;

  @ApiProperty({
    description: 'Whether SPA mode is enabled',
    example: true,
  })
  spaMode: boolean;

  @ApiProperty({
    description: 'When the preference was created',
    required: false,
  })
  createdAt?: Date;

  @ApiProperty({
    description: 'When the preference was last updated',
    required: false,
  })
  updatedAt?: Date;
}
