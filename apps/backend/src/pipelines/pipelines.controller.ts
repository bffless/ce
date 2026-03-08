import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { PipelinesService } from './pipelines.service';
import { PipelineStepsService } from './pipeline-steps.service';
import { PipelineExecutionService } from './execution';
import {
  CreatePipelineDto,
  UpdatePipelineDto,
  TestPipelineDto,
  TestPipelineConfigDto,
  PipelineResponseDto,
  PipelineWithStepsResponseDto,
  PipelinesListResponseDto,
  PipelineTestResultDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for pipeline management.
 * Pipelines define request handlers with multiple execution steps.
 */
@ApiTags('Pipelines')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/pipelines')
@UseGuards(ApiKeyGuard)
export class PipelinesController {
  constructor(
    private readonly pipelinesService: PipelinesService,
    private readonly stepsService: PipelineStepsService,
    private readonly executionService: PipelineExecutionService,
  ) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List all pipelines for a project' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of pipelines', type: PipelinesListResponseDto })
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<PipelinesListResponseDto> {
    const pipelines = await this.pipelinesService.getByProjectId(projectId);
    return { pipelines };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new pipeline' })
  @ApiResponse({ status: 201, description: 'Created pipeline', type: PipelineResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async create(
    @Body() dto: CreatePipelineDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineResponseDto> {
    return this.pipelinesService.create(dto, user.id, user.role || 'user');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a pipeline with its steps' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Pipeline details with steps', type: PipelineWithStepsResponseDto })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PipelineWithStepsResponseDto> {
    const result = await this.pipelinesService.getByIdWithSteps(id);
    if (!result) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }
    return {
      ...result.pipeline,
      steps: result.steps,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a pipeline' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated pipeline', type: PipelineResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineResponseDto> {
    return this.pipelinesService.update(id, dto, user.id, user.role || 'user');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a pipeline (cascades to steps)' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Pipeline deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.pipelinesService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }

  @Post('test-config')
  @ApiOperation({ summary: 'Test a pipeline configuration directly without saving' })
  @ApiResponse({ status: 200, description: 'Test result with debug info', type: PipelineTestResultDto })
  async testPipelineConfig(
    @Body() dto: TestPipelineConfigDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineTestResultDto> {
    // Build a pipeline-like object from the config
    const pipelineLike = {
      id: 'test-config',
      projectId: dto.projectId,
      name: dto.pipelineName || 'Test Pipeline',
      pathPattern: dto.path || '/test',
      httpMethods: [dto.method || 'POST'],
      validators: [],
      isEnabled: true,
      steps: dto.steps.map((step, index) => ({
        id: step.id,
        pipelineId: 'test-config',
        name: step.name || null,
        handlerType: step.handlerType,
        config: step.config,
        order: index,
        isEnabled: step.isEnabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };

    // Create a mock request object for testing
    const mockReq = {
      method: dto.method || 'POST',
      path: dto.path || '/test',
      body: dto.input,
      query: {},
      headers: dto.headers || {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: (header: string) => dto.headers?.[header],
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

    // Use debug execution mode
    const result = await this.executionService.executePipelineWithDebug(
      pipelineLike as any,
      mockReq,
      testUser,
      { dryRun: dto.dryRun },
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

  @Post(':id/test')
  @ApiOperation({ summary: 'Test a pipeline with sample data and debug information' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Test result with debug info', type: PipelineTestResultDto })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async testPipeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestPipelineDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineTestResultDto> {
    const pipeline = await this.pipelinesService.getById(id);
    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    // Create a mock request object for testing
    const mockReq = {
      method: dto.method || 'POST',
      path: dto.path || pipeline.pathPattern,
      body: dto.input,
      query: {},
      headers: dto.headers || {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: (header: string) => dto.headers?.[header],
    } as any;

    // Determine which user to use for the test
    // If simulateAuth is explicitly false, don't include any user
    // If mockUser is provided, use it
    // Otherwise, use the authenticated user
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

    // Use debug execution mode to capture step-by-step information
    const result = await this.executionService.executePipelineWithDebug(
      pipeline,
      mockReq,
      testUser,
      { dryRun: dto.dryRun },
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
