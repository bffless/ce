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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { PipelineStepsService } from './pipeline-steps.service';
import {
  CreatePipelineStepDto,
  UpdatePipelineStepDto,
  ReorderStepsDto,
  PipelineStepResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for pipeline steps.
 * Steps are the individual execution units within a pipeline.
 */
@ApiTags('Pipeline Steps')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/pipelines/:pipelineId/steps')
@UseGuards(ApiKeyGuard)
export class PipelineStepsController {
  constructor(private readonly stepsService: PipelineStepsService) {}

  @Get()
  @ApiOperation({ summary: 'List all steps in a pipeline' })
  @ApiParam({ name: 'pipelineId', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of steps', type: [PipelineStepResponseDto] })
  async listSteps(
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
  ): Promise<PipelineStepResponseDto[]> {
    return this.stepsService.getByPipelineId(pipelineId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a step to a pipeline' })
  @ApiParam({ name: 'pipelineId', type: 'string' })
  @ApiResponse({ status: 201, description: 'Created step', type: PipelineStepResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async addStep(
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
    @Body() dto: CreatePipelineStepDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineStepResponseDto> {
    return this.stepsService.create(pipelineId, dto, user.id, user.role || 'user');
  }

  @Put(':stepId')
  @ApiOperation({ summary: 'Update a step' })
  @ApiParam({ name: 'pipelineId', type: 'string' })
  @ApiParam({ name: 'stepId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated step', type: PipelineStepResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Step not found' })
  async updateStep(
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdatePipelineStepDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineStepResponseDto> {
    return this.stepsService.update(stepId, dto, user.id, user.role || 'user');
  }

  @Delete(':stepId')
  @ApiOperation({ summary: 'Delete a step' })
  @ApiParam({ name: 'pipelineId', type: 'string' })
  @ApiParam({ name: 'stepId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Step deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Step not found' })
  async deleteStep(
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.stepsService.delete(stepId, user.id, user.role || 'user');
    return { success: true };
  }

  @Put('reorder')
  @ApiOperation({ summary: 'Reorder steps within a pipeline' })
  @ApiParam({ name: 'pipelineId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Reordered steps', type: [PipelineStepResponseDto] })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async reorderSteps(
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
    @Body() dto: ReorderStepsDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineStepResponseDto[]> {
    return this.stepsService.reorder(pipelineId, dto, user.id, user.role || 'user');
  }
}
