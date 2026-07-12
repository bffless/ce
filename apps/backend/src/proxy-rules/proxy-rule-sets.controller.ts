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
  ImportProxyRuleSetDto,
  ExportProxyRuleSetResponseDto,
  SyncProxyRuleSetDto,
  SyncProxyRuleSetResponseDto,
  RevisionListResponseDto,
  RevisionDetailResponseDto,
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
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetsListResponseDto> {
    const ruleSets = await this.proxyRuleSetsService.listByProject(
      projectId,
      user.apiKeyProjectId,
    );
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
    return this.proxyRuleSetsService.create(
      projectId,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Post('project/:projectId/import')
  @ApiOperation({ summary: 'Import a rule set (with rules) from an exported JSON definition' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 201, description: 'Imported rule set with rules', type: ProxyRuleSetWithRulesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid import payload' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async import(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ImportProxyRuleSetDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    return this.proxyRuleSetsService.importRuleSet(
      projectId,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Put('project/:projectId/sync')
  @ApiOperation({
    summary: 'Idempotently sync a rule set from a rules-as-code payload',
    description:
      'Declarative counterpart of import (Phase 1 of proxy-rules-as-code). The payload is the ' +
      'desired state: rules match live rows on (pathPattern, method); only real differences are ' +
      'written, live-only rules are deleted only under options.prune, bundled schemas resolve by ' +
      'name, and blank header add values preserve the live secret. options.dryRun returns the ' +
      'full change plan without writing. Stamps source (syncedAt/contentHash + caller-supplied ' +
      'repo/path/gitSha) on the set and regenerates nginx when anything changed.',
  })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'The sync change report (also the dryRun plan)',
    type: SyncProxyRuleSetResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid payload (duplicate rule keys, forbidden targetUrl, strict schema mismatch)' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async sync(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SyncProxyRuleSetDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<SyncProxyRuleSetResponseDto> {
    return this.proxyRuleSetsService.syncRuleSet(
      projectId,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  // NOTE: declared before GET ':id' — Nest registers routes in declaration
  // order, so the static segments below ('/export', '/revisions',
  // '/revisions/:revisionId') must come first to guarantee they are never
  // shadowed by the plain ':id' route.
  @Get(':id/export')
  @ApiOperation({
    summary: 'Export a rule set as the canonical v2 envelope',
    description:
      'Server-side export (closes #448 — the export format is no longer a frontend contract). ' +
      'Returns the v2 envelope accepted verbatim by the bffless CLI: rule keys in canonical ' +
      'order (including methods), header add secret values blanked to empty strings, and the ' +
      'schema definitions referenced by pipeline rules bundled under schemas (omitted when none).',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'The v2 export envelope',
    type: ExportProxyRuleSetResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ExportProxyRuleSetResponseDto> {
    const envelope = await this.proxyRuleSetsService.exportRuleSet(id, user.apiKeyProjectId);
    // RuleSetExport is the runtime shape (db schema types); the DTO class only
    // exists for Swagger — same bridging cast as the other rule responses.
    return envelope as unknown as ExportProxyRuleSetResponseDto;
  }

  @Get(':id/revisions')
  @ApiOperation({
    summary: 'List captured revisions for a rule set',
    description:
      'Point-in-time snapshots captured on mutation (sync/import/create/copy/rule edits/rollback), ' +
      'newest first. `current` is computed by hashing the live rule set state per request and ' +
      'comparing it against each revision\'s stored contentHash.',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Revisions for the rule set, newest first',
    type: RevisionListResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async listRevisions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<RevisionListResponseDto> {
    return this.proxyRuleSetsService.listRevisions(
      id,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Get(':id/revisions/:revisionId')
  @ApiOperation({
    summary: 'Get a single captured revision, including its full snapshot',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'revisionId', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'The revision, including its full v2 export envelope snapshot',
    type: RevisionDetailResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set or revision not found' })
  async getRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<RevisionDetailResponseDto> {
    return this.proxyRuleSetsService.getRevision(
      id,
      revisionId,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a rule set with its rules' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Rule set details with rules', type: ProxyRuleSetWithRulesResponseDto })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    const ruleSet = await this.proxyRuleSetsService.getById(id, user.apiKeyProjectId);
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
    return this.proxyRuleSetsService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
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
    await this.proxyRuleSetsService.delete(id, user.id, user.role || 'user', user.apiKeyProjectId);
    return { success: true };
  }

  @Post(':id/copy')
  @ApiOperation({ summary: 'Copy a rule set with all its rules' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 201, description: 'Copied rule set with rules', type: ProxyRuleSetWithRulesResponseDto })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule set not found' })
  async copy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleSetWithRulesResponseDto> {
    return this.proxyRuleSetsService.copy(id, user.id, user.role || 'user', user.apiKeyProjectId);
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
      user.apiKeyProjectId,
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
    const rules = await this.proxyRulesService.reorder(
      id,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
    return { rules: rules as ProxyRuleResponseDto[] };
  }
}
