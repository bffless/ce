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
} from './pipeline-schedules.dto';

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
    const data = await this.schedulesService.listSchedules(projectId, user.id, user.role);
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
    return this.schedulesService.createSchedule(projectId, dto, user.id, user.role);
  }

  @Get('schedules/:id')
  @ApiOperation({ summary: 'Get a pipeline schedule' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, type: PipelineScheduleResponseDto })
  async getSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineScheduleResponseDto> {
    return this.schedulesService.getSchedule(id, user.id, user.role);
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
    return this.schedulesService.updateSchedule(id, dto, user.id, user.role);
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
    return this.schedulesService.deleteSchedule(id, user.id, user.role);
  }
}
