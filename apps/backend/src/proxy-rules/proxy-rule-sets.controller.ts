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
import { ProxyRuleSetsService } from './proxy-rule-sets.service';
import { ProxyRulesService } from './proxy-rules.service';
import {
  CreateProxyRuleSetDto,
  UpdateProxyRuleSetDto,
  ProxyRuleSetResponseDto,
  ProxyRuleSetWithRulesResponseDto,
  ProxyRuleSetsListResponseDto,
  CreateProxyRuleInSetDto,
  ReorderProxyRulesDto,
  ProxyRuleResponseDto,
  ProxyRulesListResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for proxy rule sets.
 * Rule sets are reusable groups of proxy rules that can be assigned to
 * aliases or set as project defaults.
 */
@ApiTags('Proxy Rule Sets')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/proxy-rule-sets')
@UseGuards(ApiKeyGuard)
export class ProxyRuleSetsController {
  constructor(
    private readonly proxyRuleSetsService: ProxyRuleSetsService,
    private readonly proxyRulesService: ProxyRulesService,
  ) {}

  // ==================== Rule Set CRUD ====================

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List all rule sets for a project' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of rule sets', type: ProxyRuleSetsListResponseDto })
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProxyRuleSetsListResponseDto> {
    const ruleSets = await this.proxyRuleSetsService.listByProject(projectId);
    return { ruleSets };
  }

  @Post('project/:projectId')
  @ApiOperation({ summary: 'Create a new rule set for a project' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 201, description: 'Created rule set', type: ProxyRuleSetResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProxyRuleSetDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetResponseDto> {
    return this.proxyRuleSetsService.create(projectId, dto, user.id, user.role || 'user');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a rule set with its rules' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Rule set details with rules', type: ProxyRuleSetWithRulesResponseDto })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    const ruleSet = await this.proxyRuleSetsService.getById(id);
    if (!ruleSet) {
      throw new NotFoundException(`Rule set ${id} not found`);
    }
    return ruleSet;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a rule set' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated rule set', type: ProxyRuleSetResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProxyRuleSetDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetResponseDto> {
    return this.proxyRuleSetsService.update(id, dto, user.id, user.role || 'user');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a rule set (cascades to rules)' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Rule set deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete rule set in use' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.proxyRuleSetsService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }

  // ==================== Rules within a Rule Set ====================

  @Get(':id/rules')
  @ApiOperation({ summary: 'List all rules in a rule set' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of rules', type: ProxyRulesListResponseDto })
  async listRules(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProxyRulesListResponseDto> {
    const rules = await this.proxyRulesService.getRulesByRuleSetId(id);
    return { rules: rules as ProxyRuleResponseDto[] };
  }

  @Post(':id/rules')
  @ApiOperation({ summary: 'Add a rule to a rule set' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 201, description: 'Created rule', type: ProxyRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async addRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProxyRuleInSetDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleResponseDto> {
    // Set the ruleSetId from the URL parameter
    return this.proxyRulesService.create(
      { ...dto, ruleSetId: id },
      user.id,
      user.role || 'user',
    ) as Promise<ProxyRuleResponseDto>;
  }

  @Put(':id/rules/reorder')
  @ApiOperation({ summary: 'Reorder rules within a rule set' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Reordered rules', type: ProxyRulesListResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async reorderRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderProxyRulesDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRulesListResponseDto> {
    const rules = await this.proxyRulesService.reorder(id, dto, user.id, user.role || 'user');
    return { rules: rules as ProxyRuleResponseDto[] };
  }
}
