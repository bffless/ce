import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { ProxyRulesService } from './proxy-rules.service';
import { UpdateProxyRuleDto, ProxyRuleResponseDto } from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { PipelineExecutionService } from '../pipelines/execution';
import { TestPipelineDto, PipelineTestResultDto } from '../pipelines/dto';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * Controller for individual proxy rule operations.
 * Rule creation, listing, and reordering are handled by the ProxyRuleSetsController.
 */
@ApiTags('Proxy Rules')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/proxy-rules')
@UseGuards(ApiKeyGuard)
export class ProxyRulesController {
  constructor(
    private readonly proxyRulesService: ProxyRulesService,
    private readonly pipelineExecutionService: PipelineExecutionService,
    @Inject(forwardRef(() => DeploymentsService))
    private readonly deploymentsService: DeploymentsService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Proxy rule details', type: ProxyRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(@Param('id', ParseUUIDPipe) id: string): Promise<ProxyRuleResponseDto> {
    const rule = await this.proxyRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Proxy rule ${id} not found`);
    }
    return rule as ProxyRuleResponseDto;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated proxy rule', type: ProxyRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProxyRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleResponseDto> {
    return this.proxyRulesService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<ProxyRuleResponseDto>;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.proxyRulesService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }

  @Post(':id/test')
  @UseInterceptors(FileInterceptor('file', { storage: require('multer').memoryStorage() }))
  @ApiOperation({ summary: 'Test a pipeline proxy rule with sample data' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Test result with debug info', type: PipelineTestResultDto })
  @ApiResponse({ status: 400, description: 'Rule is not a pipeline type' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async testPipelineRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TestPipelineDto | any,
    @CurrentUser() user: CurrentUserData,
    @Req() req: any,
  ): Promise<PipelineTestResultDto> {
    // Support both JSON body and multipart form data.
    // When multipart, the test config is in the 'data' field as a JSON string.
    let dto: TestPipelineDto;
    if (typeof body?.data === 'string') {
      try {
        dto = JSON.parse(body.data);
      } catch {
        throw new BadRequestException('Invalid JSON in "data" field');
      }
    } else {
      dto = body;
    }
    const rule = await this.proxyRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Proxy rule ${id} not found`);
    }

    if (rule.proxyType !== 'pipeline' || !rule.pipelineConfig) {
      throw new BadRequestException('This endpoint only works for pipeline-type proxy rules');
    }

    // Get the rule set to find the project ID
    const ruleSet = await this.proxyRulesService.getRuleSetById(rule.ruleSetId);
    if (!ruleSet) {
      throw new NotFoundException('Rule set not found');
    }

    // Build a pipeline-like object from the proxy rule's pipeline config
    const pipelineConfig = rule.pipelineConfig as {
      name?: string;
      description?: string;
      steps?: Array<{
        id: string;
        name?: string;
        handlerType: string;
        config: Record<string, unknown>;
        isEnabled?: boolean;
      }>;
      postSteps?: Array<{
        id: string;
        name?: string;
        handlerType: string;
        config: Record<string, unknown>;
        isEnabled?: boolean;
      }>;
      validators?: Array<{
        type: string;
        config: Record<string, unknown>;
      }>;
    };

    const pipelineLike = {
      id: `proxy-rule-${id}`,
      projectId: ruleSet.projectId,
      name: pipelineConfig.name || 'Pipeline',
      pathPattern: rule.pathPattern,
      httpMethods: ['POST'], // Default for pipelines
      validators: pipelineConfig.validators || [],
      isEnabled: true,
      steps: (pipelineConfig.steps || []).map((step, index) => ({
        id: step.id,
        pipelineId: `proxy-rule-${id}`,
        name: step.name || null,
        handlerType: step.handlerType,
        config: step.config,
        order: index,
        isEnabled: step.isEnabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      postSteps: pipelineConfig.postSteps?.map((step, index) => ({
        id: step.id || `post-step-${index}`,
        pipelineId: `proxy-rule-${id}`,
        name: step.name || `post_step_${index + 1}`,
        handlerType: step.handlerType,
        config: step.config,
        order: index,
        isEnabled: step.isEnabled ?? true,
      })),
    };

    // Create a mock request object for testing
    const mockReq = {
      method: dto.method || 'POST',
      path: dto.path || rule.pathPattern,
      body: dto.body || {},
      query: dto.query || {},
      headers: dto.headers || {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: (header: string) => dto.headers?.[header],
      file: req.file || undefined, // Pass through uploaded file for file_upload_handler
    } as any;

    // Determine which user to use for the test
    let testUser: { id: string; email?: string; role?: string } | undefined;

    if (dto.simulateAuth !== false) {
      if (dto.mockUser) {
        testUser = {
          id: dto.mockUser.id,
          email: dto.mockUser.email,
          role: dto.mockUser.role,
        };
      } else {
        testUser = {
          id: user.id,
          email: user.email,
          role: user.role,
        };
      }
    }

    // Resolve deployment context if alias is provided (for skills testing)
    // Auto-fallback to "production" alias when skills are configured but no alias specified
    let deployment: { owner: string; repo: string; commitSha: string; alias?: string } | undefined;

    // Check if skills are configured in any step
    const hasSkillsConfig = (pipelineConfig.steps || []).some(
      (step) => step.config?.skills && (step.config.skills as any).mode !== 'none',
    );

    // Use provided alias, or fallback to "production" if skills are configured
    const aliasToResolve = dto.deploymentAlias || (hasSkillsConfig ? 'production' : undefined);

    if (aliasToResolve) {
      const project = await this.projectsService.getProjectById(ruleSet.projectId);

      if (project) {
        const repoPath = `${project.owner}/${project.name}`;
        const commitSha = await this.deploymentsService.resolveAlias(repoPath, aliasToResolve);

        if (commitSha) {
          deployment = {
            owner: project.owner,
            repo: project.name,
            commitSha,
            alias: aliasToResolve,
          };
        }
      }
    }

    // Use debug execution mode
    const result = await this.pipelineExecutionService.executePipelineWithDebug(
      pipelineLike as any,
      mockReq,
      testUser,
      { dryRun: dto.dryRun, deployment },
    );

    return {
      success: result.success,
      response: result.response,
      error: result.error,
      stepOutputs: result.stepOutputs || {},
      durationMs: result.debug?.totalDurationMs || 0,
      debug: result.debug,
    };
  }
}
