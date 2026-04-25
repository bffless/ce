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
 * Creates conversations and messages schemas with a single AI chat pipeline.
 */
@Injectable()
export class ChatSchemaGeneratorService {
  private readonly logger = new Logger(ChatSchemaGeneratorService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly projectAISettingsService: ProjectAISettingsService,
  ) {}

  /**
   * Generate chat schemas with AI chat pipeline.
   *
   * Creates:
   * 1. A {name}_conversations schema for conversation metadata
   * 2. A {name}_messages schema for message history
   * 3. A rule set for the chat pipeline (or uses existing)
   * 4. Single pipeline:
   *    - POST /api/chat - AI chat handler with auto-persistence
   *
   * The AI handler automatically manages conversations and messages
   * using the persistMessages feature. useChat sends an 'id' field
   * which is used to track conversations.
   */
  async generateChatSchema(
    dto: GenerateChatSchemaDto,
    userId: string,
    userRole: string,
    apiKeyProjectId?: string | null,
  ): Promise<GenerateChatSchemaResponseDto> {
    await this.permissionsService.requireProjectAccess(
      dto.projectId,
      userId,
      userRole,
      'contributor',
      apiKeyProjectId,
    );

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

    // Create /api/chat pipelines (GET + POST)
    const pipelines: { id: string; path: string; method: string }[] = [];
    const chatPath = `/api/chat`;

    // GET /api/chat?conversationId=xxx - Retrieve messages for a conversation
    const getChatConfig = this.createGetChatPipeline(dto.name, messagesSchema.id);
    const [getChatRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: chatPath,
        method: 'GET',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: getChatConfig,
        order: 0,
        isEnabled: true,
        description: `${dto.name} get chat messages`,
      })
      .returning();
    pipelines.push({ id: getChatRule.id, path: chatPath, method: 'GET' });

    // POST /api/chat - AI chat handler with auto-persistence
    const chatConfig = this.createChatPipeline(
      dto.name,
      conversationsSchema.id,
      messagesSchema.id,
      provider,
      model,
      systemPrompt,
    );
    const [chatRule] = await db
      .insert(proxyRules)
      .values({
        ruleSetId: ruleSet.id,
        pathPattern: chatPath,
        method: 'POST',
        targetUrl: 'http://internal/pipeline',
        proxyType: 'pipeline',
        pipelineConfig: chatConfig,
        order: 1,
        isEnabled: true,
        description: `${dto.name} AI chat handler`,
      })
      .returning();
    pipelines.push({ id: chatRule.id, path: chatPath, method: 'POST' });

    this.logger.log(`Created chat pipelines for '${dto.name}'`);

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
      { name: 'chat_id', type: 'string', required: true }, // Client-provided ID (e.g., from useChat)
      { name: 'title', type: 'string', required: false },
      { name: 'model', type: 'string', required: true },
      { name: 'system_prompt', type: 'text', required: false },
      { name: 'ip_address', type: 'string', required: false },
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
      { name: 'created_at', type: 'number', required: false, default: 0 },
    ];
  }

  /**
   * Create GET pipeline to retrieve messages for a conversation.
   * Queries by conversationId query param, ordered by created_at ascending.
   */
  private createGetChatPipeline(
    name: string,
    messagesSchemaId: string,
  ): PipelineConfig {
    const stepId = `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const steps: PipelineStepConfig[] = [
      {
        id: stepId,
        name: 'query_messages',
        handlerType: 'data_query',
        config: {
          schemaId: messagesSchemaId,
          filters: {
            conversation_id: { op: 'eq', value: 'request.query.conversationId' },
          },
          orderBy: { field: 'created_at', direction: 'asc' },
          limit: 100,
        },
        isEnabled: true,
      },
    ];

    return {
      name: `${name} get messages`,
      description: `Retrieve chat messages for ${name} by conversation ID`,
      steps,
    };
  }

  /**
   * Create the single AI chat pipeline with auto-persistence.
   * The AI handler manages conversations and messages internally.
   */
  private createChatPipeline(
    name: string,
    conversationsSchemaId: string,
    messagesSchemaId: string,
    provider: string,
    model: string,
    systemPrompt: string,
  ): PipelineConfig {
    const stepId = `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const steps: PipelineStepConfig[] = [
      {
        id: stepId,
        name: 'ai',
        handlerType: 'ai_handler',
        config: {
          mode: 'chat',
          provider,
          model,
          responseMode: 'stream',
          systemPrompt,
          messagesField: 'request.body.messages',
          maxHistoryMessages: 50,
          maxTokens: 4096,
          temperature: 0.7,
          // Auto-persistence configuration
          persistMessages: true,
          persistMessagesSchemaId: messagesSchemaId,
          persistConversationsSchemaId: conversationsSchemaId,
          // useChat sends 'id' in request body for conversation tracking
          conversationIdField: 'request.body.id',
        },
        isEnabled: true,
      },
    ];

    return {
      name: `${name} AI chat`,
      description: `AI chat handler for ${name} - auto-manages conversations and messages`,
      steps,
    };
  }

}
