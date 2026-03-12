import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { StepHandler, AIHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ProjectAISettingsService, AIProviderType } from '../../projects/project-ai-settings.service';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  streamText,
  generateText,
  LanguageModel,
  ModelMessage,
} from 'ai';

/**
 * AI Handler
 *
 * AI-powered handler using Vercel AI SDK.
 * Supports two modes:
 * - Chat: For useChat integration with message history from client
 * - Completion: One-off AI processing with templated messages
 *
 * Works with OpenAI, Anthropic, and Google AI providers.
 */
@Injectable()
export class AIHandler implements StepHandler<AIHandlerConfig> {
  readonly type = 'ai_handler' as const;
  private readonly logger = new Logger(AIHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly projectAISettingsService: ProjectAISettingsService,
    private readonly dataService: PipelineDataService,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: AIHandlerConfig): void {
    if (config.mode && !['chat', 'completion'].includes(config.mode)) {
      throw new ConfigurationError(
        `Invalid mode: ${config.mode}. Must be 'chat' or 'completion'.`,
        'ai_handler',
      );
    }

    if (config.responseMode && !['stream', 'message'].includes(config.responseMode)) {
      throw new ConfigurationError(
        `Invalid responseMode: ${config.responseMode}. Must be 'stream' or 'message'.`,
        'ai_handler',
      );
    }

    if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 100000)) {
      throw new ConfigurationError(
        `Invalid maxTokens: ${config.maxTokens}. Must be between 1 and 100000.`,
        'ai_handler',
      );
    }

    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw new ConfigurationError(
        `Invalid temperature: ${config.temperature}. Must be between 0 and 2.`,
        'ai_handler',
      );
    }

    if (config.maxHistoryMessages !== undefined && config.maxHistoryMessages < 0) {
      throw new ConfigurationError(
        `Invalid maxHistoryMessages: ${config.maxHistoryMessages}. Must be >= 0.`,
        'ai_handler',
      );
    }

    if (config.provider && !['openai', 'anthropic', 'google'].includes(config.provider)) {
      throw new ConfigurationError(
        `Invalid provider: ${config.provider}. Must be 'openai', 'anthropic', or 'google'.`,
        'ai_handler',
      );
    }

    // Validate persistence config
    if (config.persistMessages) {
      if (!config.persistMessagesSchemaId) {
        throw new ConfigurationError(
          'persistMessagesSchemaId is required when persistMessages is enabled',
          'ai_handler',
        );
      }
      // userMessageFields and aiResponseFields are optional - we use smart defaults
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as AIHandlerConfig;
    const stepName = step.name || 'ai_handler';
    const mode = config.mode || 'completion';

    // Default responseMode based on mode
    const responseMode = config.responseMode || (mode === 'chat' ? 'stream' : 'message');

    this.logger.debug(`Executing AI handler for step '${stepName}' in ${mode} mode (${responseMode})`);

    // Get AI provider configuration from project settings
    const aiConfig = await this.projectAISettingsService.getProviderConfig(
      context.projectId,
      config.provider as AIProviderType | undefined,
    );

    if (!aiConfig) {
      return {
        success: false,
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: config.provider
            ? `AI provider '${config.provider}' is not configured`
            : 'No AI provider is configured',
          details: { step: stepName },
        },
      };
    }

    // Build messages based on mode
    const messages: ModelMessage[] = [];

    // Add system prompt if provided (both modes)
    let systemPrompt = config.systemPrompt;
    if (systemPrompt) {
      if (systemPrompt.startsWith('$')) {
        systemPrompt = this.expressionEvaluator.evaluateExpression(
          systemPrompt,
          context,
          stepName,
        ) as string;
      } else {
        systemPrompt = this.expressionEvaluator.evaluateTemplate(
          systemPrompt,
          context,
          stepName,
        );
      }

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
    }

    if (mode === 'chat') {
      // Chat mode: Read messages from request body or expression
      const messagesField = config.messagesField || 'messages';
      // Support full expressions (request.body.messages, steps.step1.data) or simple field names
      const messagesExpression = messagesField.includes('.')
        ? messagesField
        : `request.body.${messagesField}`;
      // Support both old format (content) and new AI SDK v3 format (parts)
      const clientMessages = this.expressionEvaluator.evaluateExpression(
        messagesExpression,
        context,
        stepName,
      ) as Array<{
        role: string;
        content?: string;
        parts?: Array<{ type: string; text?: string }>;
      }>;

      if (!Array.isArray(clientMessages)) {
        return {
          success: false,
          error: {
            code: 'MISSING_MESSAGES',
            message: `Missing or invalid messages array in field '${messagesField}'`,
            details: { step: stepName, field: messagesField },
          },
        };
      }

      const maxHistory = config.maxHistoryMessages ?? 50;
      const trimmedMessages = clientMessages.slice(-maxHistory);

      for (const msg of trimmedMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Support both old format (content) and new AI SDK v3 format (parts)
          let content: string;
          if (typeof msg.content === 'string') {
            // Old format: { role, content: "text" }
            content = msg.content;
          } else if (Array.isArray((msg as any).parts)) {
            // New AI SDK v3 format: { role, parts: [{type: "text", text: "..."}] }
            content = ((msg as any).parts as Array<{ type: string; text?: string }>)
              .filter((part) => part.type === 'text' && part.text)
              .map((part) => part.text)
              .join('');
          } else {
            // Fallback
            content = String(msg.content || '');
          }

          if (content) {
            messages.push({
              role: msg.role as 'user' | 'assistant',
              content,
            });
          }
        }
      }
    } else {
      // Completion mode: Build message from template/field
      const messageFieldConfig = config.messageField || 'message';
      let userMessage: string;

      if (messageFieldConfig.includes('{{')) {
        // Template syntax: "Hello {{request.body.name}}"
        userMessage = this.expressionEvaluator.evaluateTemplate(
          messageFieldConfig,
          context,
          stepName,
        );
      } else if (messageFieldConfig.includes('.')) {
        // Full expression: request.body.message, steps.form.data
        userMessage = this.expressionEvaluator.evaluateExpression(
          messageFieldConfig,
          context,
          stepName,
        ) as string;
      } else {
        // Simple field name: "message" → request.body.message
        userMessage = this.expressionEvaluator.evaluateExpression(
          `request.body.${messageFieldConfig}`,
          context,
          stepName,
        ) as string;
      }

      if (!userMessage || typeof userMessage !== 'string') {
        return {
          success: false,
          error: {
            code: 'MISSING_MESSAGE',
            message: `Missing or invalid message. Config: '${messageFieldConfig}'`,
            details: { step: stepName, messageField: messageFieldConfig },
          },
        };
      }

      messages.push({ role: 'user', content: userMessage });
    }

    // Create the AI model instance
    const model = this.createModel(
      aiConfig.provider,
      aiConfig.apiKey,
      config.model || aiConfig.defaultModel,
    );

    if (!model) {
      return {
        success: false,
        error: {
          code: 'INVALID_PROVIDER',
          message: `Unsupported AI provider: ${aiConfig.provider}`,
          details: { step: stepName, provider: aiConfig.provider },
        },
      };
    }

    const maxTokens = config.maxTokens ?? 4096;
    const temperature = config.temperature ?? 0.7;

    // Extract the last user message content for persistence
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const userContent = lastUserMessage?.content || '';

    try {
      if (responseMode === 'stream') {
        return await this.executeStreaming(
          context,
          stepName,
          config,
          model,
          messages,
          maxTokens,
          temperature,
          userContent as string,
        );
      } else {
        return await this.executeMessage(
          stepName,
          model,
          messages,
          maxTokens,
          temperature,
        );
      }
    } catch (error) {
      this.logger.error(`AI handler error: ${error.message}`, error.stack);
      return {
        success: false,
        error: {
          code: 'AI_ERROR',
          message: error.message || 'Failed to generate AI response',
          details: {
            step: stepName,
            provider: aiConfig.provider,
            model: config.model || aiConfig.defaultModel,
          },
        },
      };
    }
  }

  /**
   * Execute in streaming mode - uses AI SDK's data stream protocol for useChat compatibility
   */
  private async executeStreaming(
    context: PipelineContext,
    stepName: string,
    config: AIHandlerConfig,
    model: LanguageModel,
    messages: ModelMessage[],
    maxTokens: number,
    temperature: number,
    userContent: string,
  ): Promise<StepResult> {
    const response = context.request.res as Response;

    if (!response || typeof response.write !== 'function') {
      return {
        success: false,
        error: {
          code: 'STREAMING_NOT_SUPPORTED',
          message: 'Response object not available for streaming',
          details: { step: stepName },
        },
      };
    }

    this.logger.debug(`Starting streaming response for step '${stepName}'`);

    // Save user message before streaming if persistence is enabled
    if (config.persistMessages && config.persistMessagesSchemaId) {
      try {
        await this.saveUserMessage(context, stepName, config, userContent);
      } catch (error) {
        this.logger.error(`Failed to save user message: ${error.message}`, error.stack);
        // Continue with AI response - don't block on persistence errors
      }
    }

    const result = streamText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
      onFinish: async ({ text, usage, finishReason }) => {
        // Save AI response after streaming completes if persistence is enabled
        if (config.persistMessages && config.persistMessagesSchemaId) {
          try {
            await this.saveAIResponse(context, stepName, config, text, usage, finishReason);
          } catch (error) {
            this.logger.error(`Failed to save AI response: ${error.message}`, error.stack);
            // Don't throw - response has already been sent to client
          }
        }
      },
    });

    // Use AI SDK's built-in UI message stream response for useChat compatibility
    const streamResponse = result.toUIMessageStreamResponse();

    // Copy headers from the AI SDK response
    streamResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });

    // Pipe the stream body to the Express response
    if (streamResponse.body) {
      const reader = streamResponse.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          response.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    response.end();

    this.logger.debug(`Streaming complete for step '${stepName}'`);

    // Return result with terminates flag since we've already sent the response
    return {
      success: true,
      output: {
        streamed: true,
      },
      terminates: true, // Pipeline should not continue, response already sent
    };
  }

  /**
   * Execute in message mode - returns complete JSON response
   */
  private async executeMessage(
    stepName: string,
    model: LanguageModel,
    messages: ModelMessage[],
    maxTokens: number,
    temperature: number,
  ): Promise<StepResult> {
    this.logger.debug(`Generating message response for step '${stepName}'`);

    const startTime = Date.now();

    const result = await generateText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
    });

    const latencyMs = Date.now() - startTime;
    const totalTokens = result.usage?.totalTokens || 0;

    this.logger.debug(
      `Message generation complete for step '${stepName}', ${totalTokens} tokens in ${latencyMs}ms`,
    );

    return {
      success: true,
      output: {
        content: result.text,
        role: 'assistant',
        tokensUsed: totalTokens,
        usage: {
          inputTokens: result.usage?.inputTokens || 0,
          outputTokens: result.usage?.outputTokens || 0,
          totalTokens,
        },
        latencyMs,
        finishReason: result.finishReason,
      },
    };
  }

  /**
   * Create the appropriate AI model instance based on provider
   */
  private createModel(
    provider: AIProviderType,
    apiKey: string,
    modelId?: string,
  ): LanguageModel | null {
    switch (provider) {
      case 'openai': {
        const openai = createOpenAI({ apiKey });
        return openai(modelId || 'gpt-4o');
      }
      case 'anthropic': {
        const anthropic = createAnthropic({ apiKey });
        return anthropic(modelId || 'claude-sonnet-4-6');
      }
      case 'google': {
        const google = createGoogleGenerativeAI({ apiKey });
        return google(modelId || 'gemini-1.5-pro');
      }
      default:
        return null;
    }
  }

  /**
   * Save user message to the specified schema and ensure conversation exists
   */
  private async saveUserMessage(
    context: PipelineContext,
    stepName: string,
    config: AIHandlerConfig,
    userContent: string,
  ): Promise<void> {
    if (!config.persistMessagesSchemaId) {
      return;
    }

    // Verify messages schema exists and belongs to project
    const messagesSchema = await this.schemasService.getById(config.persistMessagesSchemaId);
    if (!messagesSchema) {
      throw new SchemaNotFoundError(config.persistMessagesSchemaId, stepName);
    }

    if (messagesSchema.projectId !== context.projectId) {
      throw new ConfigurationError(
        `Schema '${config.persistMessagesSchemaId}' does not belong to this project`,
        stepName,
      );
    }

    // Get chat ID (useChat sends it as 'id' in the request body)
    const conversationIdField = config.conversationIdField || 'request.body.id';
    const chatId = this.expressionEvaluator.evaluateExpression(
      conversationIdField,
      context,
      stepName,
    ) as string;

    // If conversations schema is configured, ensure conversation exists
    if (config.persistConversationsSchemaId) {
      await this.ensureConversationExists(context, stepName, config, chatId);
    }

    // Save user message
    let data: Record<string, unknown>;

    if (config.userMessageFields && Object.keys(config.userMessageFields).length > 0) {
      data = this.evaluateFieldMappings(
        config.userMessageFields,
        context,
        stepName,
        { __userContent: userContent, __conversationId: chatId },
      );
    } else {
      data = {
        conversation_id: chatId,
        role: 'user',
        content: userContent,
      };
    }

    await this.dataService.create(
      config.persistMessagesSchemaId,
      context.projectId,
      data,
      context.user?.id,
    );

    // Update conversation message count
    if (config.persistConversationsSchemaId) {
      await this.updateConversationCounts(context, config, chatId, 1, 0);
    }

    this.logger.debug(`Saved user message to schema ${config.persistMessagesSchemaId}`);
  }

  /**
   * Save AI response to the specified schema
   */
  private async saveAIResponse(
    context: PipelineContext,
    stepName: string,
    config: AIHandlerConfig,
    aiContent: string,
    usage: { totalTokens?: number } | undefined,
    finishReason: string,
  ): Promise<void> {
    if (!config.persistMessagesSchemaId) {
      return;
    }

    const conversationIdField = config.conversationIdField || 'request.body.id';
    const chatId = this.expressionEvaluator.evaluateExpression(
      conversationIdField,
      context,
      stepName,
    ) as string;

    const tokensUsed = usage?.totalTokens || 0;

    // Save AI message
    let data: Record<string, unknown>;

    if (config.aiResponseFields && Object.keys(config.aiResponseFields).length > 0) {
      data = this.evaluateFieldMappings(
        config.aiResponseFields,
        context,
        stepName,
        {
          __aiContent: aiContent,
          __tokensUsed: tokensUsed,
          __finishReason: finishReason,
          __conversationId: chatId,
        },
      );
    } else {
      data = {
        conversation_id: chatId,
        role: 'assistant',
        content: aiContent,
        tokens_used: tokensUsed,
      };
    }

    await this.dataService.create(
      config.persistMessagesSchemaId,
      context.projectId,
      data,
      context.user?.id,
    );

    // Update conversation message count and tokens
    if (config.persistConversationsSchemaId) {
      await this.updateConversationCounts(context, config, chatId, 1, tokensUsed);
    }

    this.logger.debug(`Saved AI response to schema ${config.persistMessagesSchemaId}`);
  }

  /**
   * Ensure a conversation record exists for the given chat ID
   */
  private async ensureConversationExists(
    context: PipelineContext,
    stepName: string,
    config: AIHandlerConfig,
    chatId: string,
  ): Promise<void> {
    if (!config.persistConversationsSchemaId) {
      return;
    }

    // Query for existing conversation by chat_id
    const result = await this.dataService.getBySchemaId(
      config.persistConversationsSchemaId,
      1, // page
      1, // pageSize - we just need to know if it exists
      context.user?.id || 'system',
      'admin', // Use admin to bypass permission checks since this is internal
      {
        filters: {
          chat_id: { op: 'eq', value: chatId },
        },
      },
    );

    if (result.total === 0) {
      // Create new conversation
      const conversationData: Record<string, unknown> = {
        chat_id: chatId,
        user_id: context.user?.id || null,
        model: config.model || 'unknown',
        message_count: 0,
        total_tokens: 0,
      };

      await this.dataService.create(
        config.persistConversationsSchemaId,
        context.projectId,
        conversationData,
        context.user?.id,
      );

      this.logger.debug(`Created conversation ${chatId} in schema ${config.persistConversationsSchemaId}`);
    }
  }

  /**
   * Update conversation message count and token usage
   */
  private async updateConversationCounts(
    context: PipelineContext,
    config: AIHandlerConfig,
    chatId: string,
    messageIncrement: number,
    tokensIncrement: number,
  ): Promise<void> {
    if (!config.persistConversationsSchemaId) {
      return;
    }

    try {
      // Find the conversation record
      const result = await this.dataService.getBySchemaId(
        config.persistConversationsSchemaId,
        1,
        1,
        context.user?.id || 'system',
        'admin',
        {
          filters: {
            chat_id: { op: 'eq', value: chatId },
          },
        },
      );

      if (result.records.length > 0) {
        const conversation = result.records[0];
        const currentData = conversation.data as Record<string, unknown>;
        const newMessageCount = ((currentData.message_count as number) || 0) + messageIncrement;
        const newTotalTokens = ((currentData.total_tokens as number) || 0) + tokensIncrement;

        // Update using the update method
        await this.dataService.update(
          conversation.id,
          {
            ...currentData,
            message_count: newMessageCount,
            total_tokens: newTotalTokens,
          },
          context.user?.id || 'system',
          'admin',
        );

        this.logger.debug(`Updated conversation ${chatId}: messages=${newMessageCount}, tokens=${newTotalTokens}`);
      }
    } catch (error) {
      // Log but don't fail - conversation updates are not critical
      this.logger.warn(`Failed to update conversation counts: ${error.message}`);
    }
  }

  /**
   * Evaluate field mappings with support for special variables
   */
  private evaluateFieldMappings(
    fields: Record<string, string>,
    context: PipelineContext,
    stepName: string,
    specialVars: Record<string, unknown>,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const [fieldName, expression] of Object.entries(fields)) {
      // Check if expression is a special variable
      if (expression.startsWith('__') && expression in specialVars) {
        data[fieldName] = specialVars[expression];
      } else {
        // Evaluate as a regular expression
        data[fieldName] = this.expressionEvaluator.evaluateExpression(
          expression,
          context,
          stepName,
        );
      }
    }

    return data;
  }
}
