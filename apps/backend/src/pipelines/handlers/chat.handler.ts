import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { StepHandler, ChatHandlerConfig } from '../execution/step-handler.interface';
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
 * Chat Handler
 *
 * AI-powered chat handler using Vercel AI SDK.
 * Supports streaming (SSE) and message (JSON) response modes.
 * Works with OpenAI, Anthropic, and Google AI providers.
 */
@Injectable()
export class ChatHandler implements StepHandler<ChatHandlerConfig> {
  readonly type = 'chat_handler' as const;
  private readonly logger = new Logger(ChatHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly projectAISettingsService: ProjectAISettingsService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: ChatHandlerConfig): void {
    if (config.responseMode && !['stream', 'message'].includes(config.responseMode)) {
      throw new ConfigurationError(
        `Invalid responseMode: ${config.responseMode}. Must be 'stream' or 'message'.`,
        'chat_handler',
      );
    }

    if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 100000)) {
      throw new ConfigurationError(
        `Invalid maxTokens: ${config.maxTokens}. Must be between 1 and 100000.`,
        'chat_handler',
      );
    }

    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw new ConfigurationError(
        `Invalid temperature: ${config.temperature}. Must be between 0 and 2.`,
        'chat_handler',
      );
    }

    if (config.maxHistoryMessages !== undefined && config.maxHistoryMessages < 0) {
      throw new ConfigurationError(
        `Invalid maxHistoryMessages: ${config.maxHistoryMessages}. Must be >= 0.`,
        'chat_handler',
      );
    }

    if (config.provider && !['openai', 'anthropic', 'google'].includes(config.provider)) {
      throw new ConfigurationError(
        `Invalid provider: ${config.provider}. Must be 'openai', 'anthropic', or 'google'.`,
        'chat_handler',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as ChatHandlerConfig;
    const stepName = step.name || 'chat_handler';
    const responseMode = config.responseMode || 'message';

    this.logger.debug(`Executing chat handler for step '${stepName}' in ${responseMode} mode`);

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

    // Get the user message - supports three formats:
    // 1. Simple field name: "message" -> reads $input.message
    // 2. Expression: "$input.message" or "$steps.form.message" -> evaluates expression
    // 3. Template: "Name: {{steps.form.name}}, Message: {{steps.form.message}}" -> evaluates template
    const messageFieldConfig = config.messageField || 'message';
    let userMessage: string;

    if (messageFieldConfig.includes('{{')) {
      // Template syntax - evaluate with Handlebars-style templates
      userMessage = this.expressionEvaluator.evaluateTemplate(
        messageFieldConfig,
        context,
        stepName,
      );
    } else if (messageFieldConfig.startsWith('$')) {
      // Expression syntax - evaluate directly
      userMessage = this.expressionEvaluator.evaluateExpression(
        messageFieldConfig,
        context,
        stepName,
      ) as string;
    } else {
      // Simple field name - read from input
      userMessage = this.expressionEvaluator.evaluateExpression(
        `$input.${messageFieldConfig}`,
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

    // Build message history
    const messages: ModelMessage[] = [];

    // Add system prompt if provided
    let systemPrompt = config.systemPrompt;
    if (systemPrompt) {
      // Check if it's an expression
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

    // Add conversation history if provided
    if (config.messagesField) {
      const historyMessages = this.expressionEvaluator.evaluateExpression(
        `$input.${config.messagesField}`,
        context,
        stepName,
      ) as Array<{ role: string; content: string }>;

      if (Array.isArray(historyMessages)) {
        const maxHistory = config.maxHistoryMessages ?? 50;
        const trimmedHistory = historyMessages.slice(-maxHistory);

        for (const msg of trimmedHistory) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({
              role: msg.role as 'user' | 'assistant',
              content: String(msg.content),
            });
          }
        }
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: userMessage });

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
        // Streaming mode - returns SSE stream
        return await this.executeStreaming(
          context,
          stepName,
          model,
          messages,
          maxTokens,
          temperature,
        );
      } else {
        // Message mode - returns complete response
        return await this.executeMessage(
          stepName,
          model,
          messages,
          maxTokens,
          temperature,
        );
      }
    } catch (error) {
      this.logger.error(`Chat handler error: ${error.message}`, error.stack);
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
   * Execute in streaming mode - sends SSE events directly to response
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

    // Set up SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');

    this.logger.debug(`Starting streaming response for step '${stepName}'`);

    const result = streamText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
    });

    let fullContent = '';
    let totalTokens = 0;

    try {
      for await (const chunk of result.textStream) {
        fullContent += chunk;
        // Send SSE event
        response.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
      }

      // Get final usage info
      const usage = await result.usage;
      totalTokens = usage?.totalTokens || 0;

      // Send completion event
      response.write(
        `data: ${JSON.stringify({
          type: 'done',
          content: fullContent,
          usage: {
            inputTokens: usage?.inputTokens || 0,
            outputTokens: usage?.outputTokens || 0,
            totalTokens,
          },
        })}\n\n`,
      );

      response.end();

      this.logger.debug(`Streaming complete for step '${stepName}', ${totalTokens} tokens used`);

      // Return result with terminates flag since we've already sent the response
      return {
        success: true,
        output: {
          content: fullContent,
          role: 'assistant',
          tokensUsed: totalTokens,
          streamed: true,
        },
        terminates: true, // Pipeline should not continue, response already sent
      };
    } catch (error) {
      // Send error event
      response.write(
        `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`,
      );
      response.end();

      throw error;
    }
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
