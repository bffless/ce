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

  @Post(':id/test')
  @ApiOperation({ summary: 'Test a pipeline with sample data' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Test result', type: PipelineTestResultDto })
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
    const startTime = Date.now();
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

    const result = await this.executionService.executePipeline(pipeline, mockReq, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      ...result,
      durationMs: Date.now() - startTime,
    };
  }
}
