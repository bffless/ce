import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { StepHandler, AIHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import {
  ProjectAISettingsService,
  AIProviderType,
} from '../../projects/project-ai-settings.service';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { SkillsService, SkillSummary } from '../skills.service';
import { AIToolPluginService } from '../ai-plugins/ai-tool-plugin.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText, LanguageModel, ModelMessage, stepCountIs } from 'ai';
import { z } from 'zod';

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
    private readonly skillsService: SkillsService,
    private readonly pluginService: AIToolPluginService,
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
    let responseMode = config.responseMode || (mode === 'chat' ? 'stream' : 'message');

    // Force 'message' mode if no response object available (e.g., in test/debug mode)
    const hasResponseObject =
      context.request?.res && typeof (context.request.res as any).write === 'function';
    if (responseMode === 'stream' && !hasResponseObject) {
      this.logger.debug(
        `Forcing responseMode to 'message' for step '${stepName}' - no response object available (test/debug mode)`,
      );
      responseMode = 'message';
    }

    this.logger.debug(
      `Executing AI handler for step '${stepName}' in ${mode} mode (${responseMode})`,
    );

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
        systemPrompt = this.expressionEvaluator.evaluateTemplate(systemPrompt, context, stepName);
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

    // Handle skills if deployment context is available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tools: Record<string, any> | undefined;

    // Log skills configuration for debugging
    this.logger.debug(`Skills config for step '${stepName}': mode=${config.skills?.mode || 'undefined'}`);
    this.logger.debug(
      `Deployment context for step '${stepName}': ${context.deployment ? `${context.deployment.owner}/${context.deployment.repo}@${context.deployment.commitSha?.substring(0, 8)}` : 'NOT SET'}`,
    );

    if (config.skills?.mode !== 'none' && context.deployment) {
      const { owner, repo, commitSha } = context.deployment;
      const skillsPath = await this.projectAISettingsService.getSkillsPath(context.projectId);
      this.logger.debug(`Skills path for project ${context.projectId}: ${skillsPath}`);

      try {
        const allSkills = await this.skillsService.listSkills(owner, repo, commitSha, skillsPath);
        this.logger.debug(`Found ${allSkills.length} skills: ${allSkills.map((s) => s.name).join(', ') || 'none'}`);

        const enabledSkills = this.filterSkills(allSkills, config.skills);
        this.logger.debug(
          `Enabled ${enabledSkills.length} skills after filtering: ${enabledSkills.map((s) => s.name).join(', ') || 'none'}`,
        );

        if (enabledSkills.length > 0) {
          // Append skills section to system prompt
          const skillsPromptSection = this.buildSkillsPromptSection(enabledSkills);
          const systemMessageIndex = messages.findIndex((m) => m.role === 'system');

          if (systemMessageIndex >= 0) {
            messages[systemMessageIndex].content += `\n\n${skillsPromptSection}`;
            this.logger.debug(`Appended skills section to existing system message`);
          } else {
            // Add system message if none exists
            messages.unshift({ role: 'system', content: skillsPromptSection });
            this.logger.debug(`Created new system message with skills section`);
          }

          // Create load_skill tool
          tools = {
            load_skill: this.createLoadSkillTool(owner, repo, commitSha, skillsPath, enabledSkills),
          };

          this.logger.debug(
            `Injected load_skill tool with ${enabledSkills.length} skills: ${enabledSkills.map((s) => s.name).join(', ')}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to load skills: ${error.message}`);
        // Continue without skills - don't fail the entire request
      }
    } else if (config.skills?.mode && config.skills.mode !== 'none' && !context.deployment) {
      this.logger.debug(
        `Skills mode is '${config.skills.mode}' but deployment context is not set - skills disabled`,
      );
    }

    // Build plugin tools (independent of skills system)
    // Only load plugins if the step config enables them
    if (config.plugins?.mode && config.plugins.mode !== 'none') {
      try {
        const allPluginTools = await this.pluginService.buildToolsForProject(
          context.projectId,
          config.plugins.options,
        );
        const filteredPluginTools = this.filterPluginTools(allPluginTools, config.plugins);
        const pluginToolNames = Object.keys(filteredPluginTools);

        if (pluginToolNames.length > 0) {
          tools = { ...(tools || {}), ...filteredPluginTools };

          // Append plugin tool descriptions to system prompt
          const pluginPromptSection = this.buildPluginToolsPromptSection(pluginToolNames);
          const systemMessageIndex = messages.findIndex((m) => m.role === 'system');

          if (systemMessageIndex >= 0) {
            messages[systemMessageIndex].content += `\n\n${pluginPromptSection}`;
          } else {
            messages.unshift({ role: 'system', content: pluginPromptSection });
          }

          // Append plugin-specific instructions (e.g., RAG Search usage guidance)
          const pluginInstructions = await this.pluginService.getPluginPromptInstructions(
            context.projectId,
            config.plugins.options,
          );
          if (pluginInstructions.length > 0) {
            const instructionsText = pluginInstructions.join('\n\n');
            const sysIdx = messages.findIndex((m) => m.role === 'system');
            if (sysIdx >= 0) {
              messages[sysIdx].content += `\n\n${instructionsText}`;
            }
          }

          this.logger.debug(
            `Injected ${pluginToolNames.length} plugin tools: ${pluginToolNames.join(', ')}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to load AI plugin tools: ${error.message}`);
        // Continue without plugin tools - don't fail the entire request
      }
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
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
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
          tools,
        );
      } else {
        return await this.executeMessage(stepName, model, messages, maxTokens, temperature, tools);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools?: Record<string, any>,
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

    // Deferred promise to capture onFinish data for post-processing steps
    let resolveFinishData: (data: {
      text: string;
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      finishReason: string;
      steps?: any[];
    }) => void;
    const finishDataPromise = new Promise<{
      text: string;
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      finishReason: string;
      steps?: any[];
    }>((resolve) => {
      resolveFinishData = resolve;
    });

    const hasTools = tools && Object.keys(tools).length > 0;
    const result = streamText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
      tools,
      // Enable multi-step execution when tools are available
      // Default is stepCountIs(1), increase to allow tool calls
      stopWhen: hasTools ? stepCountIs(5) : stepCountIs(1),
      onFinish: async ({ text, usage, finishReason, steps: finishSteps }) => {
        // Resolve deferred promise with finish data for post-processing
        resolveFinishData!({
          text,
          usage: usage || {},
          finishReason,
          steps: finishSteps,
        });

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

    // Await finish data to enrich output for post-processing steps
    const finishData = await finishDataPromise;

    // Extract tool calls from steps (same pattern as executeMessage)
    const allToolCalls: Array<{ toolName: string; input: unknown; output?: unknown }> = [];
    if (finishData.steps) {
      for (const step of finishData.steps) {
        if (step.toolCalls?.length) {
          for (const tc of step.toolCalls) {
            const toolCall: { toolName: string; input: unknown; output?: unknown } = {
              toolName: tc.toolName,
              input: tc.args || tc.input,
            };
            // Find matching tool result
            const matchingResult = step.toolResults?.find(
              (tr: any) => tr.toolCallId === tc.toolCallId,
            );
            if (matchingResult) {
              toolCall.output = matchingResult.result || matchingResult.output;
            }
            allToolCalls.push(toolCall);
          }
        }
      }
    }

    // Return enriched result with terminates flag since we've already sent the response
    return {
      success: true,
      output: {
        streamed: true,
        text: finishData.text,
        ...(allToolCalls.length > 0 && { toolCalls: allToolCalls }),
        usage: {
          inputTokens: finishData.usage?.inputTokens || 0,
          outputTokens: finishData.usage?.outputTokens || 0,
          totalTokens: finishData.usage?.totalTokens || 0,
        },
        finishReason: finishData.finishReason,
        resolvedMessages: messages.map((m) => ({ role: m.role, content: m.content })),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools?: Record<string, any>,
  ): Promise<StepResult> {
    const hasTools = tools && Object.keys(tools).length > 0;
    this.logger.debug(
      `Generating message response for step '${stepName}' (tools: ${hasTools ? Object.keys(tools).join(', ') : 'none'})`,
    );

    const startTime = Date.now();

    const result = await generateText({
      model,
      messages,
      maxOutputTokens: maxTokens,
      temperature,
      tools,
      // Enable tool calling when tools are available
      toolChoice: hasTools ? 'auto' : undefined,
      // Enable multi-step execution when tools are available
      // Default is stepCountIs(1), increase to allow tool calls
      stopWhen: hasTools ? stepCountIs(5) : stepCountIs(1),
    });

    const latencyMs = Date.now() - startTime;
    const totalTokens = result.usage?.totalTokens || 0;

    // Extract tool call info from steps
    const allToolCalls: Array<{ toolName: string; input: unknown }> = [];
    const allToolResults: Array<{ toolName: string; output: unknown }> = [];
    const steps = (result as any).steps;

    this.logger.debug(
      `AI generation complete for '${stepName}': ${totalTokens} tokens, ${latencyMs}ms, ${steps?.length || 1} steps`,
    );

    // Extract tool calls from steps
    if (steps) {
      for (const step of steps) {
        if (step.toolCalls?.length) {
          for (const tc of step.toolCalls) {
            allToolCalls.push({
              toolName: tc.toolName,
              input: tc.args || tc.input,
            });
          }
        }
        if (step.toolResults?.length) {
          for (const tr of step.toolResults) {
            allToolResults.push({
              toolName: tr.toolName,
              output: tr.result || tr.output,
            });
          }
        }
      }
    }

    const toolCalls = allToolCalls.length > 0 ? allToolCalls : undefined;
    const toolResults = allToolResults.length > 0 ? allToolResults : undefined;

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
        // Include tool call info if any tools were called
        ...(toolCalls?.length && { toolCalls }),
        ...(toolResults?.length && { toolResults }),
        resolvedMessages: messages.map((m) => ({ role: m.role, content: m.content })),
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
      data = this.evaluateFieldMappings(config.userMessageFields, context, stepName, {
        __userContent: userContent,
        __conversationId: chatId,
      });
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
      data = this.evaluateFieldMappings(config.aiResponseFields, context, stepName, {
        __aiContent: aiContent,
        __tokensUsed: tokensUsed,
        __finishReason: finishReason,
        __conversationId: chatId,
      });
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

      this.logger.debug(
        `Created conversation ${chatId} in schema ${config.persistConversationsSchemaId}`,
      );
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

        this.logger.debug(
          `Updated conversation ${chatId}: messages=${newMessageCount}, tokens=${newTotalTokens}`,
        );
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

  // ===== Plugin Helper Methods =====

  /**
   * Filter plugin tools based on the step's plugins configuration.
   * Tool names are namespaced as {pluginId}_{toolName}.
   */
  private filterPluginTools(
    allTools: Record<string, any>,
    config: { mode: 'none' | 'all' | 'selected'; enabled?: string[] },
  ): Record<string, any> {
    if (config.mode === 'all') {
      return allTools;
    }

    if (config.mode === 'selected' && config.enabled) {
      const enabledSet = new Set(config.enabled);
      const filtered: Record<string, any> = {};
      for (const [toolName, tool] of Object.entries(allTools)) {
        // Tool names are {pluginId}_{toolName}, extract pluginId
        const pluginId = toolName.substring(0, toolName.indexOf('_'));
        if (enabledSet.has(pluginId)) {
          filtered[toolName] = tool;
        }
      }
      return filtered;
    }

    return {};
  }

  /**
   * Build a prompt section describing available plugin tools for the AI.
   */
  private buildPluginToolsPromptSection(toolNames: string[]): string {
    const toolList = toolNames.map((name) => `- \`${name}\``).join('\n');
    return `## Available Plugin Tools

You have access to the following plugin tools that can perform actions:

${toolList}

Use these tools when they are relevant to the user's request.`;
  }

  // ===== Skills Helper Methods =====

  /**
   * Filter skills based on the skills configuration mode.
   */
  private filterSkills(
    skills: SkillSummary[],
    config?: { mode: 'none' | 'all' | 'selected'; enabled?: string[] },
  ): SkillSummary[] {
    if (!config || config.mode === 'none') {
      return [];
    }

    if (config.mode === 'all') {
      return skills;
    }

    if (config.mode === 'selected' && config.enabled) {
      return skills.filter((s) => config.enabled!.includes(s.name));
    }

    return [];
  }

  /**
   * Build a prompt section describing available skills for the AI.
   */
  private buildSkillsPromptSection(skills: SkillSummary[]): string {
    const skillList = skills.map((s) => `- **${s.name}**: ${s.description}`).join('\n');

    return `## Available Skills

You have access to specialized skills that provide domain-specific knowledge and instructions. Use the \`load_skill\` tool to get full instructions when you need detailed guidance for a specific task.

${skillList}`;
  }

  /**
   * Create a load_skill tool that allows the AI to dynamically load skill content.
   */
  private createLoadSkillTool(
    owner: string,
    repo: string,
    commitSha: string,
    skillsPath: string,
    enabledSkills: SkillSummary[],
  ) {
    const skillNames = new Set(enabledSkills.map((s) => s.name));
    const skillsService = this.skillsService;
    const logger = this.logger;

    // Use simple string schema with description listing valid values
    // Validation happens in execute to avoid complex type inference
    const skillNamesDescription = Array.from(skillNames).join(', ');

    // Create tool object directly without the tool() helper to avoid deep type inference
    // The tool() helper just returns its input as-is anyway
    return {
      description: `Load detailed instructions and guidance for a specific skill. Available skills: ${skillNamesDescription}`,
      inputSchema: z.object({
        skillName: z
          .string()
          .describe(`Name of the skill to load. Must be one of: ${skillNamesDescription}`),
      }),
      execute: async ({ skillName }: { skillName: string }) => {
        // Validate skill name
        if (!skillNames.has(skillName)) {
          logger.warn(`Invalid skill name requested: '${skillName}'`);
          return {
            error: `Invalid skill name '${skillName}'. Available skills: ${skillNamesDescription}`,
          };
        }

        try {
          const skill = await skillsService.loadSkill(
            owner,
            repo,
            commitSha,
            skillsPath,
            skillName,
          );

          if (!skill) {
            logger.warn(`Skill '${skillName}' not found during tool call`);
            return { error: `Skill '${skillName}' not found` };
          }

          return {
            name: skill.name,
            description: skill.description,
            instructions: skill.content,
          };
        } catch (error) {
          logger.error(`Error loading skill '${skillName}': ${error.message}`);
          return { error: `Failed to load skill '${skillName}': ${error.message}` };
        }
      },
    };
  }
}
