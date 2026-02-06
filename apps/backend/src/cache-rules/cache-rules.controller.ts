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
import { CacheRulesService } from './cache-rules.service';
import {
  CreateCacheRuleDto,
  UpdateCacheRuleDto,
  ReorderCacheRulesDto,
  CacheRuleResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('Cache Rules')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/cache-rules')
@UseGuards(ApiKeyGuard)
export class CacheRulesController {
  constructor(private readonly cacheRulesService: CacheRulesService) {}

  /**
   * Get all cache rules for a project
   */
  @Get('project/:projectId')
  @ApiOperation({ summary: 'List cache rules for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'List of cache rules',
    type: [CacheRuleResponseDto],
  })
  async getProjectRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ rules: CacheRuleResponseDto[] }> {
    const rules = await this.cacheRulesService.getRulesByProjectId(projectId);
    return { rules: rules as CacheRuleResponseDto[] };
  }

  /**
   * Create a new cache rule for a project
   */
  @Post('project/:projectId')
  @ApiOperation({ summary: 'Create a cache rule for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 201,
    description: 'Created cache rule',
    type: CacheRuleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async createRule(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateCacheRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CacheRuleResponseDto> {
    return this.cacheRulesService.create(
      projectId,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<CacheRuleResponseDto>;
  }

  /**
   * Reorder cache rules for a project
   */
  @Put('project/:projectId/reorder')
  @ApiOperation({ summary: 'Reorder cache rules for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Reordered cache rules',
    type: [CacheRuleResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid input or rule not in project' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async reorderRules(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReorderCacheRulesDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ rules: CacheRuleResponseDto[] }> {
    const rules = await this.cacheRulesService.reorder(
      projectId,
      dto,
      user.id,
      user.role || 'user',
    );
    return { rules: rules as CacheRuleResponseDto[] };
  }

  /**
   * Get a specific cache rule
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific cache rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Cache rule ID' })
  @ApiResponse({ status: 200, description: 'Cache rule details', type: CacheRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(@Param('id', ParseUUIDPipe) id: string): Promise<CacheRuleResponseDto> {
    const rule = await this.cacheRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Cache rule ${id} not found`);
    }
    return rule as CacheRuleResponseDto;
  }

  /**
   * Update a cache rule
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a cache rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Cache rule ID' })
  @ApiResponse({ status: 200, description: 'Updated cache rule', type: CacheRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCacheRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CacheRuleResponseDto> {
    return this.cacheRulesService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<CacheRuleResponseDto>;
  }

  /**
   * Delete a cache rule
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a cache rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Cache rule ID' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.cacheRulesService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }
}
