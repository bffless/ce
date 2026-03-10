import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsIn, MaxLength, Matches, IsOptional } from 'class-validator';

/**
 * Scope for state schema:
 * - 'global': State is shared across all users (lookup by key only)
 * - 'user': State is isolated per user/guest (lookup by key + user_id or guest_id)
 */
export type StateScope = 'global' | 'user';

/**
 * DTO for generating a state schema with associated pipelines.
 * Creates a schema optimized for use with @bffless/use-bff-state React hook.
 */
export class GenerateStateSchemaDto {
  @ApiProperty({
    description: 'Project ID this schema belongs to',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'Schema name (unique within project). Use lowercase letters, numbers, and underscores.',
    example: 'user_state',
  })
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
  name: string;

  @ApiProperty({
    description: 'State scope: global (shared) or user (isolated per user/guest)',
    enum: ['global', 'user'],
    example: 'user',
  })
  @IsIn(['global', 'user'])
  scope: StateScope;

  @ApiPropertyOptional({
    description: 'Existing rule set ID to add pipelines to. If not provided, a new rule set will be created.',
  })
  @IsOptional()
  @IsUUID()
  ruleSetId?: string;
}

/**
 * Response DTO for state schema generation
 */
export class GenerateStateSchemaResponseDto {
  @ApiProperty({
    description: 'The created schema',
  })
  schema: {
    id: string;
    name: string;
    projectId: string;
    fields: { name: string; type: string; required: boolean }[];
    createdAt: string;
    updatedAt: string;
  };

  @ApiProperty({
    description: 'The created pipelines',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        path: { type: 'string' },
        method: { type: 'string' },
      },
    },
  })
  pipelines: { id: string; path: string; method: string }[];
}
