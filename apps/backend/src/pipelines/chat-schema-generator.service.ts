import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { db } from '../db/client';
import { pipelineSchemas, proxyRuleSets, proxyRules, NewPipelineSchema } from '../db/schema';
import { PermissionsService } from '../permissions/permissions.service';
import { ProjectAISettingsService, AIProviderType } from '../projects/project-ai-settings.service';
import { GenerateChatSchemaDto, GenerateChatSchemaResponseDto } from './dto/generate-chat-schema.dto';
import type { SchemaField } from '../db/schema/pipeline-schemas.schema';
import type { PipelineConfig, PipelineStepConfig } from '../db/schema/proxy-rules.schema';
import { eq, and } from 'drizzle-orm';

/**
 * Service for generating chat schemas with AI-powered conversation pipelines.
 * Creates conversations and messages schemas with CRUD + AI chat pipelines.
 */
@Injectable()
export class ChatSchemaGeneratorService {
  private readonly logger = new Logger(ChatSchemaGeneratorService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly projectAISettingsService: ProjectAISettingsService,
  ) {}

  /**
   * Generate chat schemas with conversation management and AI chat pipelines.
   *
   * Creates:
   * 1. A {name}_conversations schema for conversation metadata
   * 2. A {name}_messages schema for message history
   * 3. A rule set for chat pipelines (or uses existing)
   * 4. Five pipelines:
   *    - GET /api/chat/{name}/conversations - List conversations
   *    - POST /api/chat/{name}/conversations - Create conversation
   *    - GET /api/chat/{name}/conversations/:id - Get conversation with messages
   *    - POST /api/chat/{name}/conversations/:id/messages - Send message (AI chat)
   *    - DELETE /api/chat/{name}/conversations/:id - Delete conversation
   */
  async generateChatSchema(
    dto: GenerateChatSchemaDto,
    userId: string,
    userRole: string,
  ): Promise<GenerateChatSchemaResponseDto> {
    // Check project access
    await this.checkProjectAccess(dto.projectId, userId, userRole, 'contributor');

    // Get AI config from project settings to validate and get defaults
    const aiConfig = await this.projectAISettingsService.getProviderConfig(
      dto.projectId,
      dto.provider as AIProviderType | undefined,
    );
    if (!aiConfig) {
      throw new ConflictException(
        dto.provider
          ? `AI provider '${dto.provider}' is not configured for this project`
          : 'No AI provider is configured for this project. Configure AI settings in Project Settings first.',
      );
    }

    const provider = aiConfig.provider;
    const model = dto.model || aiConfig.defaultModel || 'gpt-4o'; // fallback model
    const systemPrompt = dto.systemPrompt || 'You are a helpful assistant.';

    // Check for existing schemas with same name
    const conversationsName = `${dto.name}_conversations`;
    const messagesName = `${dto.name}_messages`;

    const [existingConversations] = await db
      .select()
      .from(pipelineSchemas)
      .where(
        and(
          eq(pipelineSchemas.projectId, dto.projectId),
          eq(pipelineSchemas.name, conversationsName),
        ),
      )
      .limit(1);

    if (existingConversations) {
      throw new ConflictException(`A schema with name "${conversationsName}" already exists`);
    }

    const [existingMessages] = await db
      .select()
      .from(pipelineSchemas)
      .where(
        and(
          eq(pipelineSchemas.projectId, dto.projectId),
          eq(pipelineSchemas.name, messagesName),
        ),
      )
      .limit(1);

    if (existingMessages) {
      throw new ConflictException(`A schema with name "${messagesName}" already exists`);
    }

    // Create conversations schema
    const conversationsFields = this.getConversationsFields(dto.scope);
    const [conversationsSchema] = await db
      .insert(pipelineSchemas)
      .values({
        projectId: dto.projectId,
        name: conversationsName,
        fields: conversationsFields,
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created conversations schema '${conversationsName}' (${conversationsSchema.id})`);

    // Create messages schema
    const messagesFields = this.getMessagesFields();
    const [messagesSchema] = await db
      .insert(pipelineSchemas)
      .values({
        projectId: dto.projectId,
        name: messagesName,
        fields: messagesFields,
      } as NewPipelineSchema)
      .returning();

    this.logger.log(`Created messages schema '${messagesName}' (${messagesSchema.id})`);

    // Use existing rule set or create a new one
    let ruleSet: { id: string; name: string };

    if (dto.ruleSetId) {
      // Verify the rule set exists and belongs to this project
      const [existingRuleSet] = await db
        .select()
        .from(proxyRuleSets)
        .where(
          and(
            eq(proxyRuleSets.id, dto.ruleSetId),
            eq(proxyRuleSets.projectId, dto.projectId),
          ),
        )
        .limit(1);

      if (!existingRuleSet) {
        throw new Error(`Rule set ${dto.ruleSetId} not found or does not belong to this project`);
      }

      ruleSet = existingRuleSet;
      this.logger.log(`Using existing rule set '${ruleSet.name}' (${ruleSet.id})`);
    } else {
      // Create new rule set for chat pipelines
      const ruleSetName = `${dto.name}_chat_pipelines`;
      const [newRuleSet] = await db
        .insert(proxyRuleSets)
        .values({
          projectId: dto.projectId,
          name: ruleSetName,
          description: `Auto-generated pipelines for ${dto.name} chat`,
        })
        .returning();

      ruleSet = newRuleSet;
      this.logger.log(`Created rule set '${ruleSet.name}' (${ruleSet.id})`);
    }

    // Create the 5 pipelines
    const pipelines: { id: string; path: string; method: string }[] = [];
    const basePath = `/api/chat/${dto.name}`;
    let order = 0;

    // 1. GET /conversations - List user's conversations
    const listConfig = this.createListConversationsPipeline(
      dto.name,
      dto.scope,
      conversationsSchema.id,
    );
    const [listRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: `${basePath}/conversations`,
        method: 'GET',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: listConfig,
        order: order++,
        isEnabled: true,
        description: `List ${dto.name} conversations`,
      })
      .returning();
    pipelines.push({ id: listRule.id, path: `${basePath}/conversations`, method: 'GET' });

    // 2. POST /conversations - Create conversation
    const createConfig = this.createCreateConversationPipeline(
      dto.name,
      dto.scope,
      conversationsSchema.id,
      provider,
      model,
      systemPrompt,
    );
    const [createRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: `${basePath}/conversations`,
        method: 'POST',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: createConfig,
        order: order++,
        isEnabled: true,
        description: `Create ${dto.name} conversation`,
      })
      .returning();
    pipelines.push({ id: createRule.id, path: `${basePath}/conversations`, method: 'POST' });

    // 3. GET /conversations/:id - Get conversation with messages
    const getConfig = this.createGetConversationPipeline(
      dto.name,
      dto.scope,
      conversationsSchema.id,
      messagesSchema.id,
    );
    const [getRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: `${basePath}/conversations/:id`,
        method: 'GET',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: getConfig,
        order: order++,
        isEnabled: true,
        description: `Get ${dto.name} conversation`,
      })
      .returning();
    pipelines.push({ id: getRule.id, path: `${basePath}/conversations/:id`, method: 'GET' });

    // 4. POST /conversations/:id/messages - Send message (AI chat)
    const chatConfig = this.createSendMessagePipeline(
      dto.name,
      dto.scope,
      conversationsSchema.id,
      messagesSchema.id,
      provider,
      model,
    );
    const [chatRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: `${basePath}/conversations/:id/messages`,
        method: 'POST',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: chatConfig,
        order: order++,
        isEnabled: true,
        description: `Send message to ${dto.name} conversation`,
      })
      .returning();
    pipelines.push({ id: chatRule.id, path: `${basePath}/conversations/:id/messages`, method: 'POST' });

    // 5. DELETE /conversations/:id - Delete conversation
    const deleteConfig = this.createDeleteConversationPipeline(
      dto.name,
      dto.scope,
      conversationsSchema.id,
      messagesSchema.id,
    );
    const [deleteRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: `${basePath}/conversations/:id`,
        method: 'DELETE',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: deleteConfig,
        order: order++,
        isEnabled: true,
        description: `Delete ${dto.name} conversation`,
      })
      .returning();
    pipelines.push({ id: deleteRule.id, path: `${basePath}/conversations/:id`, method: 'DELETE' });

    this.logger.log(`Created ${pipelines.length} pipelines for chat schema '${dto.name}'`);

    return {
      conversationsSchema: {
        id: conversationsSchema.id,
        name: conversationsSchema.name,
        projectId: conversationsSchema.projectId,
        fields: conversationsSchema.fields.map((f) => ({
          name: f.name,
          type: f.type,
          required: f.required,
        })),
        createdAt: conversationsSchema.createdAt.toISOString(),
        updatedAt: conversationsSchema.updatedAt.toISOString(),
      },
      messagesSchema: {
        id: messagesSchema.id,
        name: messagesSchema.name,
        projectId: messagesSchema.projectId,
        fields: messagesSchema.fields.map((f) => ({
          name: f.name,
          type: f.type,
          required: f.required,
        })),
        createdAt: messagesSchema.createdAt.toISOString(),
        updatedAt: messagesSchema.updatedAt.toISOString(),
      },
      pipelines,
    };
  }

  /**
   * Get schema fields for conversations
   */
  private getConversationsFields(scope: 'user' | 'guest'): SchemaField[] {
    const fields: SchemaField[] = [
      { name: 'title', type: 'string', required: false },
      { name: 'model', type: 'string', required: true },
      { name: 'system_prompt', type: 'text', required: false },
      { name: 'message_count', type: 'number', required: true, default: 0 },
      { name: 'total_tokens', type: 'number', required: true, default: 0 },
      { name: 'metadata', type: 'json', required: false },
    ];

    if (scope === 'user') {
      fields.unshift({ name: 'user_id', type: 'string', required: true });
    } else {
      fields.unshift({ name: 'user_id', type: 'string', required: false });
      fields.unshift({ name: 'guest_id', type: 'string', required: false });
    }

    return fields;
  }

  /**
   * Get schema fields for messages
   */
  private getMessagesFields(): SchemaField[] {
    return [
      { name: 'conversation_id', type: 'string', required: true },
      { name: 'role', type: 'string', required: true }, // 'user' | 'assistant' | 'system'
      { name: 'content', type: 'text', required: true },
      { name: 'tokens_used', type: 'number', required: false, default: 0 },
      { name: 'metadata', type: 'json', required: false },
    ];
  }

  /**
   * Create pipeline for listing conversations
   */
  private createListConversationsPipeline(
    name: string,
    scope: 'user' | 'guest',
    conversationsSchemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Query conversations for user/guest
    const filters: Record<string, { op: string; value: string }> =
      scope === 'user'
        ? { user_id: { op: 'eq', value: 'user.id' } }
        : { guest_id: { op: 'eq', value: 'request.query._bffGuestId' } };

    steps.push({
      id: 'query',
      name: 'query',
      handlerType: 'data_query',
      config: {
        schemaId: conversationsSchemaId,
        filters,
        orderBy: { field: 'updatedAt', direction: 'desc' },
        limit: 50,
      },
      isEnabled: true,
    });

    // Step 2: Return conversations
    steps.push({
      id: 'response',
      name: 'Return Conversations',
      handlerType: 'response_handler',
      config: {
        status: 200,
        body: '{ "conversations": {{{steps.query}}} }',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `List ${name} conversations`,
      description: `List all ${name} conversations for the current user`,
      steps,
    };
  }

  /**
   * Create pipeline for creating a conversation
   */
  private createCreateConversationPipeline(
    name: string,
    scope: 'user' | 'guest',
    conversationsSchemaId: string,
    provider: string,
    model: string,
    systemPrompt: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Create conversation record
    const fields: Record<string, string> = {
      title: 'request.body.title',
      model: `"${model}"`,
      system_prompt: `request.body.system_prompt || "${systemPrompt.replace(/"/g, '\\"')}"`,
      message_count: '0',
      total_tokens: '0',
      metadata: 'request.body.metadata || {}',
    };

    if (scope === 'user') {
      fields.user_id = 'user.id';
    } else {
      fields.user_id = 'user.id';
      fields.guest_id = 'request.query._bffGuestId';
    }

    steps.push({
      id: 'create',
      name: 'create',
      handlerType: 'data_create',
      config: {
        schemaId: conversationsSchemaId,
        fields,
      },
      isEnabled: true,
    });

    // Step 2: Return created conversation
    steps.push({
      id: 'response',
      name: 'Return Conversation',
      handlerType: 'response_handler',
      config: {
        status: 201,
        body: '{{{steps.create}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `Create ${name} conversation`,
      description: `Create a new ${name} conversation`,
      steps,
    };
  }

  /**
   * Create pipeline for getting a conversation with messages
   */
  private createGetConversationPipeline(
    name: string,
    scope: 'user' | 'guest',
    conversationsSchemaId: string,
    messagesSchemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Get conversation by ID
    steps.push({
      id: 'getConversation',
      name: 'getConversation',
      handlerType: 'data_query',
      config: {
        schemaId: conversationsSchemaId,
        recordId: 'request.params.id',
        single: true,
      },
      isEnabled: true,
    });

    // Step 2: Check ownership (function handler)
    const ownerCheck =
      scope === 'user'
        ? 'steps.getConversation?.user_id === user?.id'
        : '(steps.getConversation?.user_id === user?.id || steps.getConversation?.guest_id === request.query._bffGuestId)';

    steps.push({
      id: 'checkOwnership',
      name: 'checkOwnership',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ user, request, steps }) {
  if (!steps.getConversation) {
    return { error: 'not_found', status: 404 };
  }
  const isOwner = ${ownerCheck};
  if (!isOwner) {
    return { error: 'forbidden', status: 403 };
  }
  return { ok: true };
}`,
      },
      isEnabled: true,
    });

    // Step 3: Get messages for conversation
    steps.push({
      id: 'getMessages',
      name: 'getMessages',
      handlerType: 'data_query',
      config: {
        schemaId: messagesSchemaId,
        filters: {
          conversation_id: { op: 'eq', value: 'request.params.id' },
        },
        orderBy: { field: 'createdAt', direction: 'asc' },
        condition: 'steps.checkOwnership?.ok',
      },
      isEnabled: true,
    });

    // Step 4: Return conversation with messages or error
    steps.push({
      id: 'formatResponse',
      name: 'formatResponse',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ steps }) {
  if (steps.checkOwnership?.error) {
    return {
      __status: steps.checkOwnership.status,
      error: steps.checkOwnership.error,
      message: steps.checkOwnership.error === 'not_found' ? 'Conversation not found' : 'Access denied',
    };
  }
  return {
    ...steps.getConversation,
    messages: steps.getMessages || [],
  };
}`,
      },
      isEnabled: true,
    });

    steps.push({
      id: 'response',
      name: 'Return Response',
      handlerType: 'response_handler',
      config: {
        status: 'steps.formatResponse?.__status || 200',
        body: '{{{steps.formatResponse}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `Get ${name} conversation`,
      description: `Get a ${name} conversation with message history`,
      steps,
    };
  }

  /**
   * Create pipeline for sending a message (AI chat)
   */
  private createSendMessagePipeline(
    name: string,
    scope: 'user' | 'guest',
    conversationsSchemaId: string,
    messagesSchemaId: string,
    provider: string,
    model: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Get conversation
    steps.push({
      id: 'getConversation',
      name: 'getConversation',
      handlerType: 'data_query',
      config: {
        schemaId: conversationsSchemaId,
        recordId: 'request.params.id',
        single: true,
      },
      isEnabled: true,
    });

    // Step 2: Check ownership
    const ownerCheck =
      scope === 'user'
        ? 'steps.getConversation?.user_id === user?.id'
        : '(steps.getConversation?.user_id === user?.id || steps.getConversation?.guest_id === request.query._bffGuestId)';

    steps.push({
      id: 'checkOwnership',
      name: 'checkOwnership',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ user, request, steps }) {
  if (!steps.getConversation) {
    return { error: 'not_found', status: 404 };
  }
  const isOwner = ${ownerCheck};
  if (!isOwner) {
    return { error: 'forbidden', status: 403 };
  }
  return { ok: true };
}`,
      },
      isEnabled: true,
    });

    // Step 3: Get message history
    steps.push({
      id: 'getHistory',
      name: 'getHistory',
      handlerType: 'data_query',
      config: {
        schemaId: messagesSchemaId,
        filters: {
          conversation_id: { op: 'eq', value: 'request.params.id' },
        },
        orderBy: { field: 'createdAt', direction: 'asc' },
        limit: 50,
        condition: 'steps.checkOwnership?.ok',
      },
      isEnabled: true,
    });

    // Step 4: Save user message
    steps.push({
      id: 'saveUserMessage',
      name: 'saveUserMessage',
      handlerType: 'data_create',
      config: {
        schemaId: messagesSchemaId,
        fields: {
          conversation_id: 'request.params.id',
          role: '"user"',
          content: 'request.body.content',
          tokens_used: '0',
        },
        condition: 'steps.checkOwnership?.ok',
      },
      isEnabled: true,
    });

    // Step 5: Call AI handler in chat mode
    steps.push({
      id: 'chat',
      name: 'chat',
      handlerType: 'ai_handler',
      config: {
        mode: 'chat',
        provider,
        model,
        responseMode: 'stream',
        systemPrompt: '$steps.getConversation.system_prompt',
        messagesField: 'steps.getHistory',
        maxHistoryMessages: 50,
        conversationsSchemaId,
        messagesSchemaId,
      },
      isEnabled: true,
    });

    // Step 6: Save assistant message
    steps.push({
      id: 'saveAssistantMessage',
      name: 'saveAssistantMessage',
      handlerType: 'data_create',
      config: {
        schemaId: messagesSchemaId,
        fields: {
          conversation_id: 'request.params.id',
          role: '"assistant"',
          content: 'steps.chat.content',
          tokens_used: 'steps.chat.usage?.totalTokens || 0',
        },
        condition: 'steps.chat?.content',
      },
      isEnabled: true,
    });

    // Step 7: Update conversation stats
    steps.push({
      id: 'updateConversation',
      name: 'updateConversation',
      handlerType: 'data_update',
      config: {
        schemaId: conversationsSchemaId,
        recordId: 'request.params.id',
        single: true,
        fields: {
          message_count: '(steps.getConversation.message_count || 0) + 2',
          total_tokens:
            '(steps.getConversation.total_tokens || 0) + (steps.chat.usage?.totalTokens || 0)',
        },
        condition: 'steps.chat?.content',
      },
      isEnabled: true,
    });

    // Step 8: Return response or error
    steps.push({
      id: 'formatResponse',
      name: 'formatResponse',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ steps }) {
  if (steps.checkOwnership?.error) {
    return {
      __status: steps.checkOwnership.status,
      error: steps.checkOwnership.error,
      message: steps.checkOwnership.error === 'not_found' ? 'Conversation not found' : 'Access denied',
    };
  }
  if (!steps.chat?.content) {
    return {
      __status: 500,
      error: 'ai_error',
      message: steps.chat?.error || 'Failed to generate AI response',
    };
  }
  return {
    message: steps.saveAssistantMessage,
    usage: steps.chat.usage,
  };
}`,
      },
      isEnabled: true,
    });

    steps.push({
      id: 'response',
      name: 'Return Response',
      handlerType: 'response_handler',
      config: {
        status: 'steps.formatResponse?.__status || 200',
        body: '{{{steps.formatResponse}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `Send ${name} message`,
      description: `Send a message and get AI response`,
      steps,
    };
  }

  /**
   * Create pipeline for deleting a conversation
   */
  private createDeleteConversationPipeline(
    name: string,
    scope: 'user' | 'guest',
    conversationsSchemaId: string,
    messagesSchemaId: string,
  ): PipelineConfig {
    const steps: PipelineStepConfig[] = [];

    // Step 1: Get conversation
    steps.push({
      id: 'getConversation',
      name: 'getConversation',
      handlerType: 'data_query',
      config: {
        schemaId: conversationsSchemaId,
        recordId: 'request.params.id',
        single: true,
      },
      isEnabled: true,
    });

    // Step 2: Check ownership
    const ownerCheck =
      scope === 'user'
        ? 'steps.getConversation?.user_id === user?.id'
        : '(steps.getConversation?.user_id === user?.id || steps.getConversation?.guest_id === request.query._bffGuestId)';

    steps.push({
      id: 'checkOwnership',
      name: 'checkOwnership',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ user, request, steps }) {
  if (!steps.getConversation) {
    return { error: 'not_found', status: 404 };
  }
  const isOwner = ${ownerCheck};
  if (!isOwner) {
    return { error: 'forbidden', status: 403 };
  }
  return { ok: true };
}`,
      },
      isEnabled: true,
    });

    // Step 3: Delete messages
    steps.push({
      id: 'deleteMessages',
      name: 'deleteMessages',
      handlerType: 'data_delete',
      config: {
        schemaId: messagesSchemaId,
        filters: {
          conversation_id: { op: 'eq', value: 'request.params.id' },
        },
        condition: 'steps.checkOwnership?.ok',
      },
      isEnabled: true,
    });

    // Step 4: Delete conversation
    steps.push({
      id: 'deleteConversation',
      name: 'deleteConversation',
      handlerType: 'data_delete',
      config: {
        schemaId: conversationsSchemaId,
        recordId: 'request.params.id',
        condition: 'steps.checkOwnership?.ok',
      },
      isEnabled: true,
    });

    // Step 5: Return response or error
    steps.push({
      id: 'formatResponse',
      name: 'formatResponse',
      handlerType: 'function_handler',
      config: {
        code: `function handler({ steps }) {
  if (steps.checkOwnership?.error) {
    return {
      __status: steps.checkOwnership.status,
      error: steps.checkOwnership.error,
      message: steps.checkOwnership.error === 'not_found' ? 'Conversation not found' : 'Access denied',
    };
  }
  return {
    success: true,
    deleted: {
      conversation: 1,
      messages: steps.deleteMessages?.count || 0,
    },
  };
}`,
      },
      isEnabled: true,
    });

    steps.push({
      id: 'response',
      name: 'Return Response',
      handlerType: 'response_handler',
      config: {
        status: 'steps.formatResponse?.__status || 200',
        body: '{{{steps.formatResponse}}}',
        contentType: 'application/json',
      },
      isEnabled: true,
    });

    return {
      name: `Delete ${name} conversation`,
      description: `Delete a ${name} conversation and all messages`,
      steps,
    };
  }

  /**
   * Check project access
   */
  private async checkProjectAccess(
    projectId: string,
    userId: string,
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin' | 'owner' = 'contributor',
  ): Promise<void> {
    if (userRole === 'admin') {
      return;
    }

    const role = await this.permissionsService.getUserProjectRole(userId, projectId);

    if (!role) {
      throw new Error('You do not have access to this project');
    }

    const roleHierarchy = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
    const userLevel = roleHierarchy[role] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    if (userLevel < requiredLevel) {
      throw new Error(`This action requires ${requiredRole} role or higher`);
    }
  }
}
