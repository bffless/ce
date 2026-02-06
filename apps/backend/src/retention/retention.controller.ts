import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
import { RetentionService } from './retention.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  CreateRetentionRuleDto,
  UpdateRetentionRuleDto,
  RetentionRuleResponseDto,
  ListRetentionRulesResponseDto,
  PreviewDeletionResponseDto,
  ExecuteRuleResponseDto,
  ListRetentionLogsResponseDto,
  ListRetentionLogsQueryDto,
  StorageOverviewDto,
} from './retention.dto';

@ApiTags('Retention Rules')
@Controller('api/retention')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get('projects/:projectId/rules')
  @ApiOperation({ summary: 'List retention rules for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, type: ListRetentionRulesResponseDto })
  @ApiResponse({ status: 403, description: 'Not authorized to access this project' })
  async listRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListRetentionRulesResponseDto> {
    const rules = await this.retentionService.listRules(projectId, user.id, user.role);
    return { data: rules };
  }

  @Post('projects/:projectId/rules')
  @ApiOperation({ summary: 'Create a new retention rule' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, type: RetentionRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized (requires admin role)' })
  async createRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRetentionRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<RetentionRuleResponseDto> {
    return this.retentionService.createRule(projectId, dto, user.id, user.role);
  }

  @Get('projects/:projectId/overview')
  @ApiOperation({ summary: 'Get storage overview for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, type: StorageOverviewDto })
  @ApiResponse({ status: 403, description: 'Not authorized to access this project' })
  async getStorageOverview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<StorageOverviewDto> {
    return this.retentionService.getStorageOverview(projectId, user.id, user.role);
  }

  @Get('projects/:projectId/logs')
  @ApiOperation({ summary: 'Get retention deletion logs for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, type: ListRetentionLogsResponseDto })
  @ApiResponse({ status: 403, description: 'Not authorized to access this project' })
  async getRetentionLogs(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListRetentionLogsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListRetentionLogsResponseDto> {
    return this.retentionService.getRetentionLogs(projectId, query, user.id, user.role);
  }

  @Get('rules/:ruleId')
  @ApiOperation({ summary: 'Get a specific retention rule' })
  @ApiParam({ name: 'ruleId', description: 'Retention rule ID' })
  @ApiResponse({ status: 200, type: RetentionRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this project' })
  async getRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<RetentionRuleResponseDto> {
    return this.retentionService.getRule(ruleId, user.id, user.role);
  }

  @Put('rules/:ruleId')
  @ApiOperation({ summary: 'Update a retention rule' })
  @ApiParam({ name: 'ruleId', description: 'Retention rule ID' })
  @ApiResponse({ status: 200, type: RetentionRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 403, description: 'Not authorized (requires admin role)' })
  async updateRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateRetentionRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<RetentionRuleResponseDto> {
    return this.retentionService.updateRule(ruleId, dto, user.id, user.role);
  }

  @Delete('rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a retention rule' })
  @ApiParam({ name: 'ruleId', description: 'Retention rule ID' })
  @ApiResponse({ status: 204, description: 'Rule deleted successfully' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 403, description: 'Not authorized (requires admin role)' })
  async deleteRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    return this.retentionService.deleteRule(ruleId, user.id, user.role);
  }

  @Get('rules/:ruleId/preview')
  @ApiOperation({ summary: 'Preview what commits would be deleted by a rule' })
  @ApiParam({ name: 'ruleId', description: 'Retention rule ID' })
  @ApiResponse({ status: 200, type: PreviewDeletionResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this project' })
  async previewDeletion(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PreviewDeletionResponseDto> {
    return this.retentionService.previewDeletion(ruleId, user.id, user.role);
  }

  @Post('rules/:ruleId/execute')
  @ApiOperation({ summary: 'Manually execute a retention rule' })
  @ApiParam({ name: 'ruleId', description: 'Retention rule ID' })
  @ApiResponse({ status: 200, type: ExecuteRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 403, description: 'Not authorized (requires admin role)' })
  async executeRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ExecuteRuleResponseDto> {
    return this.retentionService.executeRule(ruleId, user.id, user.role);
  }
}
