import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { PipelineSchedulesService } from './pipeline-schedules.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  CreatePipelineScheduleDto,
  UpdatePipelineScheduleDto,
  PipelineScheduleResponseDto,
  ListPipelineSchedulesResponseDto,
  ListPipelineRuleOptionsResponseDto,
} from './pipeline-schedules.dto';

/**
 * REST surface for pipeline schedules. Route shape:
 *
 *   GET/POST          /api/pipeline-schedules/projects/:projectId/schedules
 *   GET/PUT/DELETE    /api/pipeline-schedules/schedules/:id
 *
 * Deliberately NOT nested under /api/projects/:id/... — that prefix is owned by
 * ProjectsController, whose two-segment catch-all (@Get(':owner/:name')) would
 * swallow such paths and fail with a misleading "Project not found". Same reason
 * proxy-rule-sets lives at /api/proxy-rule-sets/project/:projectId.
 *
 * Works with session auth and API keys; a project-scoped key (apiKeyProjectId)
 * is authorized only for its own project's schedules.
 */
@ApiTags('Pipeline Schedules')
@Controller('api/pipeline-schedules')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class PipelineSchedulesController {
  constructor(private readonly schedulesService: PipelineSchedulesService) {}

  @Get('projects/:projectId/schedules')
  @ApiOperation({ summary: 'List pipeline schedules for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, type: ListPipelineSchedulesResponseDto })
  async listSchedules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListPipelineSchedulesResponseDto> {
    const data = await this.schedulesService.listSchedules(
      projectId,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return { data };
  }

  @Get('projects/:projectId/pipeline-rules')
  @ApiOperation({ summary: 'List pipeline-type proxy rules in a project (schedule targets)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, type: ListPipelineRuleOptionsResponseDto })
  async listPipelineRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListPipelineRuleOptionsResponseDto> {
    const data = await this.schedulesService.listPipelineRules(
      projectId,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
    return { data };
  }

  @Post('projects/:projectId/schedules')
  @ApiOperation({ summary: 'Create a pipeline schedule' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, type: PipelineScheduleResponseDto })
  async createSchedule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreatePipelineScheduleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineScheduleResponseDto> {
    return this.schedulesService.createSchedule(
      projectId,
      dto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );
  }

  @Get('schedules/:id')
  @ApiOperation({ summary: 'Get a pipeline schedule' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, type: PipelineScheduleResponseDto })
  async getSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineScheduleResponseDto> {
    return this.schedulesService.getSchedule(id, user.id, user.role, user.apiKeyProjectId);
  }

  @Put('schedules/:id')
  @ApiOperation({ summary: 'Update a pipeline schedule (rename, re-cron, enable/disable)' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, type: PipelineScheduleResponseDto })
  async updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineScheduleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineScheduleResponseDto> {
    return this.schedulesService.updateSchedule(id, dto, user.id, user.role, user.apiKeyProjectId);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a pipeline schedule' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 204, description: 'Schedule deleted' })
  async deleteSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    return this.schedulesService.deleteSchedule(id, user.id, user.role, user.apiKeyProjectId);
  }
}
