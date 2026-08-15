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
  action: 'create_repo_from_template' | 'set_repo_variable' | 'create_issue' | 'add_issue_comment' | 'close_issue' | 'close_pull_request' | 'merge_pull_request' | 'list_pull_requests' | 'dispatch' | 'list_workflow_runs' | 'get_workflow_run';

  // --- dispatch fields ---

  /** Event type for repository_dispatch (expression, e.g. "'compose'") */
  eventType?: string;

  /** Optional structured payload delivered to the workflow as github.event.client_payload */
  clientPayload?: Record<string, unknown>;

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

  // --- create_issue fields ---

  /** Issue title (expression) */
  title?: string;

  /** Issue body (expression) */
  body?: string;

  /** Labels to apply (array of strings) */
  labels?: string[];

  // --- close_issue / close_pull_request / merge_pull_request fields ---

  /** Issue or PR number (expression) */
  issueNumber?: string;

  // --- merge_pull_request fields ---

  /** Merge method (expression, default: merge) */
  mergeMethod?: string;

  // --- list_pull_requests fields ---

  /** PR state filter (expression, default: open) */
  state?: string;

  // --- workflow run fields ---

  /** Filter runs by triggering event, e.g. "'repository_dispatch'" (expression) */
  event?: string;

  /** Filter runs by status or conclusion, e.g. "'in_progress'" (expression) */
  status?: string;

  /** Number of runs to return, 1-100 (default 30) */
  perPage?: number;

  /** Workflow run id for get_workflow_run (expression) */
  runId?: string;
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
    } else if (config.action === 'create_issue') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for create_issue', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for create_issue', 'github_api');
      }
      if (!config.title) {
        throw new ConfigurationError('title is required for create_issue', 'github_api');
      }
      if (!config.body) {
        throw new ConfigurationError('body is required for create_issue', 'github_api');
      }
    } else if (config.action === 'add_issue_comment') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for add_issue_comment', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for add_issue_comment', 'github_api');
      }
      if (!config.issueNumber) {
        throw new ConfigurationError('issueNumber is required for add_issue_comment', 'github_api');
      }
      if (!config.body) {
        throw new ConfigurationError('body is required for add_issue_comment', 'github_api');
      }
    } else if (config.action === 'close_issue' || config.action === 'close_pull_request') {
      if (!config.owner) {
        throw new ConfigurationError(`owner is required for ${config.action}`, 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError(`repo is required for ${config.action}`, 'github_api');
      }
      if (!config.issueNumber) {
        throw new ConfigurationError(`issueNumber is required for ${config.action}`, 'github_api');
      }
    } else if (config.action === 'merge_pull_request') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for merge_pull_request', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for merge_pull_request', 'github_api');
      }
      if (!config.issueNumber) {
        throw new ConfigurationError('issueNumber (PR number) is required for merge_pull_request', 'github_api');
      }
    } else if (config.action === 'list_pull_requests') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for list_pull_requests', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for list_pull_requests', 'github_api');
      }
    } else if (config.action === 'dispatch') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for dispatch', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for dispatch', 'github_api');
      }
      if (!config.eventType) {
        throw new ConfigurationError('eventType is required for dispatch', 'github_api');
      }
    } else if (config.action === 'list_workflow_runs') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for list_workflow_runs', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for list_workflow_runs', 'github_api');
      }
      if (config.perPage !== undefined && (config.perPage < 1 || config.perPage > 100)) {
        throw new ConfigurationError('perPage must be between 1 and 100', 'github_api');
      }
    } else if (config.action === 'get_workflow_run') {
      if (!config.owner) {
        throw new ConfigurationError('owner is required for get_workflow_run', 'github_api');
      }
      if (!config.repo) {
        throw new ConfigurationError('repo is required for get_workflow_run', 'github_api');
      }
      if (!config.runId) {
        throw new ConfigurationError('runId is required for get_workflow_run', 'github_api');
      }
    } else {
      throw new ConfigurationError(
        `Unknown action '${config.action}'. Supported: create_repo_from_template, set_repo_variable, create_issue, add_issue_comment, close_issue, close_pull_request, merge_pull_request, list_pull_requests, dispatch, list_workflow_runs, get_workflow_run`,
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

    if (config.action === 'create_issue') {
      return this.createIssue(config, context, step, token);
    }

    if (config.action === 'add_issue_comment') {
      return this.addIssueComment(config, context, step, token);
    }

    if (config.action === 'close_issue') {
      return this.closeIssue(config, context, step, token);
    }

    if (config.action === 'close_pull_request') {
      return this.closePullRequest(config, context, step, token);
    }

    if (config.action === 'merge_pull_request') {
      return this.mergePullRequest(config, context, step, token);
    }

    if (config.action === 'list_pull_requests') {
      return this.listPullRequests(config, context, step, token);
    }

    if (config.action === 'dispatch') {
      return this.dispatch(config, context, step, token);
    }

    if (config.action === 'list_workflow_runs') {
      return this.listWorkflowRuns(config, context, step, token);
    }

    if (config.action === 'get_workflow_run') {
      return this.getWorkflowRun(config, context, step, token);
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

  private async createIssue(
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
    const title = String(
      this.expressionEvaluator.evaluateExpression(config.title!, context, step.name),
    );
    const body = String(
      this.expressionEvaluator.evaluateExpression(config.body!, context, step.name),
    );

    const labels: string[] = [];
    if (config.labels && Array.isArray(config.labels)) {
      for (const label of config.labels) {
        const resolved = this.expressionEvaluator.evaluateExpression(label, context, step.name);
        if (resolved) {
          labels.push(String(resolved));
        }
      }
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`;

    this.logger.debug(`Creating issue on '${owner}/${repo}': ${title}`);

    try {
      const requestBody: Record<string, unknown> = { title, body };
      if (labels.length > 0) {
        requestBody.labels = labels;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify(requestBody),
      });

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
            details: {
              status: response.status,
              errors: (errorBody as any).errors,
            },
          },
        };
      }

      const issue = await response.json();

      this.logger.log(`Created issue #${issue.number} on '${owner}/${repo}'`);

      return {
        success: true,
        output: {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          html_url: issue.html_url,
          state: issue.state,
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

  private async addIssueComment(
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
    const issueNumber = String(
      this.expressionEvaluator.evaluateExpression(config.issueNumber!, context, step.name),
    );
    const body = String(
      this.expressionEvaluator.evaluateExpression(config.body!, context, step.name),
    );

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

    this.logger.debug(`Adding comment to issue #${issueNumber} on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body }),
      });

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
            details: {
              status: response.status,
              errors: (errorBody as any).errors,
            },
          },
        };
      }

      const comment = await response.json();

      this.logger.log(`Added comment ${comment.id} to issue #${issueNumber} on '${owner}/${repo}'`);

      return {
        success: true,
        output: {
          id: comment.id,
          html_url: comment.html_url,
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

  private async closeIssue(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const issueNumber = String(this.expressionEvaluator.evaluateExpression(config.issueNumber!, context, step.name));

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`;
    this.logger.debug(`Closing issue #${issueNumber} on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ state: 'closed' }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const issue = await response.json();
      this.logger.log(`Closed issue #${issueNumber} on '${owner}/${repo}'`);
      return { success: true, output: { number: issue.number, state: issue.state, html_url: issue.html_url } };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  private async closePullRequest(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const prNumber = String(this.expressionEvaluator.evaluateExpression(config.issueNumber!, context, step.name));

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
    this.logger.debug(`Closing PR #${prNumber} on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ state: 'closed' }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const pr = await response.json();
      this.logger.log(`Closed PR #${prNumber} on '${owner}/${repo}'`);
      return { success: true, output: { number: pr.number, state: pr.state, html_url: pr.html_url } };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  private async mergePullRequest(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const prNumber = String(this.expressionEvaluator.evaluateExpression(config.issueNumber!, context, step.name));

    let mergeMethod = 'merge';
    if (config.mergeMethod) {
      mergeMethod = String(this.expressionEvaluator.evaluateExpression(config.mergeMethod, context, step.name));
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/merge`;
    this.logger.debug(`Merging PR #${prNumber} on '${owner}/${repo}' with method '${mergeMethod}'`);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ merge_method: mergeMethod }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const result = await response.json();
      this.logger.log(`Merged PR #${prNumber} on '${owner}/${repo}'`);
      return { success: true, output: { sha: result.sha, merged: result.merged, message: result.message } };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  private async listPullRequests(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));

    let state = 'open';
    if (config.state) {
      state = String(this.expressionEvaluator.evaluateExpression(config.state, context, step.name));
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`;
    this.logger.debug(`Listing PRs on '${owner}/${repo}' with state '${state}'`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const prs = await response.json();
      this.logger.log(`Found ${prs.length} PRs on '${owner}/${repo}'`);
      return {
        success: true,
        output: prs.map((pr: any) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          head_ref: pr.head?.ref,
          body: pr.body,
        })),
      };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  /** Shape a GitHub workflow-run object down to the fields pipelines actually use. */
  private mapWorkflowRun(run: any) {
    return {
      id: run.id,
      name: run.name,
      display_title: run.display_title,
      status: run.status,
      conclusion: run.conclusion,
      html_url: run.html_url,
      run_number: run.run_number,
      event: run.event,
      head_branch: run.head_branch,
      created_at: run.created_at,
      updated_at: run.updated_at,
    };
  }

  private async listWorkflowRuns(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));

    const params = new URLSearchParams({ per_page: String(config.perPage ?? 30) });
    if (config.event) {
      params.set('event', String(this.expressionEvaluator.evaluateExpression(config.event, context, step.name)));
    }
    if (config.status) {
      params.set('status', String(this.expressionEvaluator.evaluateExpression(config.status, context, step.name)));
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?${params.toString()}`;
    this.logger.debug(`Listing workflow runs on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const body = await response.json();
      const runs = Array.isArray((body as any).workflow_runs) ? (body as any).workflow_runs : [];
      this.logger.log(`Found ${runs.length} workflow runs on '${owner}/${repo}'`);
      return { success: true, output: runs.map((run: any) => this.mapWorkflowRun(run)) };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  private async getWorkflowRun(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const runId = String(this.expressionEvaluator.evaluateExpression(config.runId!, context, step.name));

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}`;
    this.logger.debug(`Fetching workflow run '${runId}' on '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return {
          success: false,
          error: { code: 'GITHUB_API_ERROR', message: `GitHub API error: ${(errorBody as any).message || response.status}` },
        };
      }

      const run = await response.json();
      return { success: true, output: this.mapWorkflowRun(run) };
    } catch (error: any) {
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }

  private async dispatch(
    config: GitHubApiHandlerConfig,
    context: PipelineContext,
    step: PipelineStep,
    token: string,
  ): Promise<StepResult> {
    const owner = String(this.expressionEvaluator.evaluateExpression(config.owner!, context, step.name));
    const repo = String(this.expressionEvaluator.evaluateExpression(config.repo!, context, step.name));
    const eventType = String(this.expressionEvaluator.evaluateExpression(config.eventType!, context, step.name));

    const clientPayload: Record<string, unknown> = {};
    if (config.clientPayload && typeof config.clientPayload === 'object') {
      for (const [key, raw] of Object.entries(config.clientPayload)) {
        if (typeof raw === 'string') {
          clientPayload[key] = this.expressionEvaluator.evaluateExpression(raw, context, step.name);
        } else {
          clientPayload[key] = raw;
        }
      }
    }

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/dispatches`;
    this.logger.debug(`Dispatching '${eventType}' to '${owner}/${repo}'`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      });

      // 204 No Content is the success response for repository_dispatch.
      if (response.status === 204) {
        this.logger.log(`Dispatched '${eventType}' to '${owner}/${repo}'`);
        return { success: true, output: { eventType, owner, repo, clientPayload } };
      }

      const errorBody = await response.json().catch(() => ({}));
      const message = (errorBody as any).message || `HTTP ${response.status}`;
      this.logger.error(`GitHub API error for step '${step.name}': ${response.status} - ${message}`);
      return {
        success: false,
        error: {
          code: 'GITHUB_API_ERROR',
          message: `GitHub API error: ${message}`,
          details: { status: response.status, errors: (errorBody as any).errors },
        },
      };
    } catch (error: any) {
      this.logger.error(`GitHub API request failed for step '${step.name}': ${error.message}`);
      return { success: false, error: { code: 'GITHUB_API_ERROR', message: `GitHub API request failed: ${error.message}` } };
    }
  }
}
