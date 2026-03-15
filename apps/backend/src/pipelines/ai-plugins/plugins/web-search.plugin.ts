import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolDefinition,
  AIToolContext,
} from '../ai-tool-plugin.interface';
import { AIToolPluginRegistry } from '../ai-tool-plugin.registry';

/**
 * Web Search plugin — uses a configurable search API to find web results.
 * Supports Google Custom Search API. Requires API key and Search Engine ID.
 */
@Injectable()
export class WebSearchPlugin implements AIToolPlugin {
  readonly metadata: AIToolPluginMetadata = {
    id: 'web-search',
    name: 'Web Search',
    description: 'Search the web for current information using Google Custom Search API.',
    category: 'information',
    icon: 'search',
    configSchema: z.object({
      apiKey: z.string().min(1).describe('Google Custom Search API key'),
      searchEngineId: z.string().min(1).describe('Google Custom Search Engine ID (cx)'),
    }),
  };

  constructor(private readonly registry: AIToolPluginRegistry) {
    this.registry.register(this);
  }

  async validateConfig(
    config: Record<string, unknown>,
  ): Promise<{ valid: boolean; error?: string }> {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      return { valid: false, error: 'API key is required' };
    }
    if (!config.searchEngineId || typeof config.searchEngineId !== 'string') {
      return { valid: false, error: 'Search Engine ID is required' };
    }
    return { valid: true };
  }

  getTools(config: Record<string, unknown>): AIToolDefinition[] {
    return [
      {
        name: 'search',
        description:
          'Search the web for information. Returns titles, snippets, and URLs of top results.',
        inputSchema: z.object({
          query: z.string().describe('The search query'),
          numResults: z
            .number()
            .min(1)
            .max(10)
            .optional()
            .describe('Number of results to return (1-10, default 5)'),
        }),
        execute: async (args: { query: string; numResults?: number }, context: AIToolContext) => {
          return this.search(
            args.query,
            args.numResults ?? 5,
            context.pluginConfig.apiKey as string,
            context.pluginConfig.searchEngineId as string,
          );
        },
      },
    ];
  }

  private async search(
    query: string,
    numResults: number,
    apiKey: string,
    searchEngineId: string,
  ): Promise<
    { results: Array<{ title: string; snippet: string; url: string }> } | { error: string }
  > {
    try {
      const params = new URLSearchParams({
        key: apiKey,
        cx: searchEngineId,
        q: query,
        num: String(numResults),
      });

      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      );

      if (!response.ok) {
        const error = await response.json();
        return { error: error.error?.message || `Search API returned HTTP ${response.status}` };
      }

      const data = await response.json();
      const results = (data.items || []).map((item: any) => ({
        title: item.title,
        snippet: item.snippet,
        url: item.link,
      }));

      return { results };
    } catch (error) {
      return { error: `Search failed: ${error.message}` };
    }
  }
}
