import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsIn, MaxLength, Matches, IsOptional } from 'class-validator';

/**
 * Scope for chat schema:
 * - 'user': Conversations are isolated per authenticated user
 * - 'guest': Conversations use guest ID (anonymous, can be upgraded to user)
 */
export type ChatScope = 'user' | 'guest';

/**
 * DTO for generating a chat schema with associated AI pipelines.
 * Creates conversations and messages schemas with CRUD + AI chat pipelines.
 */
export class GenerateChatSchemaDto {
  @ApiProperty({
    description: 'Project ID this schema belongs to',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description:
      'Chat name (unique within project). Use lowercase letters, numbers, and underscores. Will create {name}_conversations and {name}_messages schemas.',
    example: 'support',
  })
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
  })
  name: string;

  @ApiProperty({
    description: 'Chat scope: user (authenticated) or guest (anonymous)',
    enum: ['user', 'guest'],
    example: 'user',
  })
  @IsIn(['user', 'guest'])
  scope: ChatScope;

  @ApiPropertyOptional({
    description: 'AI provider to use (defaults to configured provider)',
    example: 'openai',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'AI model to use (defaults to configured default model)',
    example: 'gpt-4o',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'Default system prompt for conversations',
    example: 'You are a helpful assistant.',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional({
    description:
      'Existing rule set ID to add pipelines to. If not provided, a new rule set will be created.',
  })
  @IsOptional()
  @IsUUID()
  ruleSetId?: string;
}

/**
 * Response DTO for chat schema generation
 */
export class GenerateChatSchemaResponseDto {
  @ApiProperty({
    description: 'The created conversations schema',
  })
  conversationsSchema: {
    id: string;
    name: string;
    projectId: string;
    fields: { name: string; type: string; required: boolean }[];
    createdAt: string;
    updatedAt: string;
  };

  @ApiProperty({
    description: 'The created messages schema',
  })
  messagesSchema: {
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
