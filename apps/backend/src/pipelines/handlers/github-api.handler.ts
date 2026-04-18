import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, BaseHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IntegrationsService } from '../../integrations/integrations.service';

/**
 * Configuration for github_api handler
 */
export interface GitHubApiHandlerConfig extends BaseHandlerConfig {
  /** The GitHub API action to perform */
  action: 'create_repo_from_template' | 'set_repo_variable';

  // --- create_repo_from_template fields ---

  /** Template owner (expression, e.g. "bffless-templates") */
  templateOwner?: string;

  /** Template repo name (expression) */
  templateRepo?: string;

  /** Target org to create the repo in (expression) */
  targetOrg?: string;

  /** New repo name (expression) */
  repoName?: string;

  /** Whether the new repo should be private (default: true) */
  private?: boolean;

  /** Optional description (expression) */
  description?: string;

  /** Include all branches from template (default: false) */
  includeAllBranches?: boolean;

  // --- set_repo_variable fields ---

  /** Repository owner (expression) */
  owner?: string;

  /** Repository name (expression) */
  repo?: string;

  /** Variable name (expression) */
  variableName?: string;

  /** Variable value (expression) */
  variableValue?: string;
}

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * GitHub API Handler
 *
 * Interacts with the GitHub REST API using credentials from the GitHub integration.
 * Currently supports creating repositories from templates.
 *
 * Requires GitHub integration to be configured in project settings.
 */
@Injectable()
export class GitHubApiHandler implements StepHandler<GitHubApiHandlerConfig> {
  readonly type = 'github_api' as const;
  private readonly logger = new Logger(GitHubApiHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly integrationsService: IntegrationsService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: GitHubApiHandlerConfig): void {
    if (!config.action) {
      throw new ConfigurationError('action is required', 'github_api');
    }

    if (config.action === 'create_repo_from_template') {
      if (!config.templateOwner) {
        throw new ConfigurationError('templateOwner is required for create_repo_from_template', 'github_api');
      }
      if (!config.templateRepo) {
        throw new ConfigurationError('templateRepo is required for create_repo_from_template', 'github_api');
      }
      if (!config.targetOrg) {
        throw new ConfigurationError('targetOrg is required for create_repo_from_template', 'github_api');
      }
      if (!config.repoName) {
        throw new ConfigurationError('repoName is required for create_repo_from_template', 'github_api');
      }
    } else if (config.action === 'set_repo_variable') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for set_repo_variable', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for set_repo_variable', 'github_api');
      }
      if (!config.variableName) {
        throw new ConfigurationError('variableName is required for set_repo_variable', 'github_api');
      }
      if (!config.variableValue) {
        throw new ConfigurationError('variableValue is required for set_repo_variable', 'github_api');
      }
    } else {
      throw new ConfigurationError(
        `Unknown action '${config.action}'. Supported: create_repo_from_template, set_repo_variable`,
        'github_api',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as GitHubApiHandlerConfig;

    // Get GitHub PAT from integration
    const githubConfig = await this.integrationsService.getActiveConfig(
      context.projectId,
      'github',
    );

    if (!githubConfig?.personalAccessToken) {
      return {
        success: false,
        error: {
          code: 'GITHUB_NOT_CONFIGURED',
          message: 'GitHub integration is not configured for this project. Configure it in Project Settings > Integrations.',
        },
      };
    }

    const token = githubConfig.personalAccessToken as string;

    if (config.action === 'create_repo_from_template') {
      return this.createRepoFromTemplate(config, context, step, token);
    }

    if (config.action === 'set_repo_variable') {
      return this.setRepoVariable(config, context, step, token);
    }

    return {
      success: false,
      error: {
        code: 'UNKNOWN_ACTION',
        message: `Unknown github_api action: ${config.action}`,
      },
    };
  }

  private async createRepoFromTemplate(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const templateOwner = String(
      this.expressionEvaluator.evaluateExpression(config.templateOwner!, context, step.name),
    );
    const templateRepo = String(
      this.expressionEvaluator.evaluateExpression(config.templateRepo!, context, step.name),
    );
    const targetOrg = String(
      this.expressionEvaluator.evaluateExpression(config.targetOrg!, context, step.name),
    );
    const repoName = String(
      this.expressionEvaluator.evaluateExpression(config.repoName!, context, step.name),
    );

    let description = '';
    if (config.description) {
      const resolved = this.expressionEvaluator.evaluateExpression(config.description, context, step.name);
      if (resolved) {
        description = String(resolved);
      }
    }

    const url = `${GITHUB_API_BASE}/repos/${templateOwner}/${templateRepo}/generate`;

    this.logger.debug(
      `Creating repo '${repoName}' in '${targetOrg}' from template '${templateOwner}/${templateRepo}'`,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          owner: targetOrg,
          name: repoName,
          description,
          private: config.private !== false,
          include_all_branches: config.includeAllBranches ?? false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = errorBody.message || `HTTP ${response.status}`;

        this.logger.error(
          `GitHub API error for step '${step.name}': ${response.status} - ${message}`,
        );

        return {
          success: false,
          error: {
            code: 'GITHUB_API_ERROR',
            message: `GitHub API error: ${message}`,
            details: {
              status: response.status,
              errors: errorBody.errors,
            },
          },
        };
      }

      const repo = await response.json();

      this.logger.log(`Created repo '${repo.full_name}' from template`);

      return {
        success: true,
        output: {
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          clone_url: repo.clone_url,
          private: repo.private,
          default_branch: repo.default_branch,
        },
      };
    } catch (error: any) {
      this.logger.error(`GitHub API request failed for step '${step.name}': ${error.message}`);

      return {
        success: false,
        error: {
          code: 'GITHUB_API_ERROR',
          message: `GitHub API request failed: ${error.message}`,
        },
      };
    }
  }

  private async setRepoVariable(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(
      this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name),
    );
    const repo = String(
      this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name),
    );
    const variableName = String(
      this.expressionEvaluator.evaluateExpression(config.variableName!, context, step.name),
    );
    const variableValue = String(
      this.expressionEvaluator.evaluateExpression(config.variableValue!, context, step.name),
    );

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/variables/${variableName}`;

    this.logger.debug(
      `Setting variable '${variableName}' on '${owner}/${repo}'`,
    );

    try {
      // Try PATCH first (update existing variable)
      let response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ name: variableName, value: variableValue }),
      });

      // If variable doesn't exist (404), create it with POST
      if (response.status === 404) {
        response = await fetch(
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/variables`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ name: variableName, value: variableValue }),
          },
        );
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = (errorBody as any).message || `HTTP ${response.status}`;

        this.logger.error(
          `GitHub API error for step '${step.name}': ${response.status} - ${message}`,
        );

        return {
          success: false,
          error: {
            code: 'GITHUB_API_ERROR',
            message: `GitHub API error: ${message}`,
            details: { status: response.status },
          },
        };
      }

      this.logger.log(`Set variable '${variableName}' on '${owner}/${repo}'`);

      return {
        success: true,
        output: {
          owner,
          repo,
          variableName,
          variableValue,
        },
      };
    } catch (error: any) {
      this.logger.error(`GitHub API request failed for step '${step.name}': ${error.message}`);

      return {
        success: false,
        error: {
          code: 'GITHUB_API_ERROR',
          message: `GitHub API request failed: ${error.message}`,
        },
      };
    }
  }
}
