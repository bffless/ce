import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { StepHandler, AIHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ProjectAISettingsService, AIProviderType } from '../../projects/project-ai-settings.service';
import { ConfigurationError } from '../errors';
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
      const clientMessages = this.expressionEvaluator.evaluateExpression(
        messagesExpression,
        context,
        stepName,
      ) as Array<{ role: string; content: string }>;

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
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: String(msg.content),
          });
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

    try {
      if (responseMode === 'stream') {
        return await this.executeStreaming(
          context,
          stepName,
          model,
          messages,
          maxTokens,
          temperature,
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
    model: LanguageModel,
    messages: ModelMessage[],
    maxTokens: number,
    temperature: number,
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

    const result = streamText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
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
}
