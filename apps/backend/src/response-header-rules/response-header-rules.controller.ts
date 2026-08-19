import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
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
import { ResponseHeaderRulesService } from './response-header-rules.service';
import {
  CreateResponseHeaderRuleDto,
  UpdateResponseHeaderRuleDto,
  ReorderResponseHeaderRulesDto,
  ResponseHeaderRuleResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('Response Header Rules')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/response-header-rules')
@UseGuards(ApiKeyGuard)
export class ResponseHeaderRulesController {
  constructor(private readonly responseHeaderRulesService: ResponseHeaderRulesService) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List response header rules for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'List of response header rules',
    type: [ResponseHeaderRuleResponseDto],
  })
  async getProjectRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ rules: ResponseHeaderRuleResponseDto[] }> {
    const rules = await this.responseHeaderRulesService.getRulesByProjectId(projectId);
    return { rules: rules as ResponseHeaderRuleResponseDto[] };
  }

  @Post('project/:projectId')
  @ApiOperation({ summary: 'Create a response header rule for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 201,
    description: 'Created response header rule',
    type: ResponseHeaderRuleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async createRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateResponseHeaderRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ResponseHeaderRuleResponseDto> {
    return this.responseHeaderRulesService.create(
      projectId,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<ResponseHeaderRuleResponseDto>;
  }

  @Put('project/:projectId/reorder')
  @ApiOperation({ summary: 'Reorder response header rules for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Reordered response header rules',
    type: [ResponseHeaderRuleResponseDto],
  })
  async reorderRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReorderResponseHeaderRulesDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ rules: ResponseHeaderRuleResponseDto[] }> {
    const rules = await this.responseHeaderRulesService.reorder(
      projectId,
      dto,
      user.id,
      user.role || 'user',
    );
    return { rules: rules as ResponseHeaderRuleResponseDto[] };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific response header rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Rule ID' })
  @ApiResponse({
    status: 200,
    description: 'Response header rule details',
    type: ResponseHeaderRuleResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(@Param('id', ParseUUIDPipe) id: string): Promise<ResponseHeaderRuleResponseDto> {
    const rule = await this.responseHeaderRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Response header rule ${id} not found`);
    }
    return rule as ResponseHeaderRuleResponseDto;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a response header rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Rule ID' })
  @ApiResponse({
    status: 200,
    description: 'Updated response header rule',
    type: ResponseHeaderRuleResponseDto,
  })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResponseHeaderRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ResponseHeaderRuleResponseDto> {
    return this.responseHeaderRulesService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<ResponseHeaderRuleResponseDto>;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a response header rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Rule ID' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.responseHeaderRulesService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }
}
