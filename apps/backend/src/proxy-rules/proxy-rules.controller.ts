import {
  Controller,
  Get,
  Patch,
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
import { ProxyRulesService } from './proxy-rules.service';
import { UpdateProxyRuleDto, ProxyRuleResponseDto } from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for individual proxy rule operations.
 * Rule creation, listing, and reordering are handled by the ProxyRuleSetsController.
 */
@ApiTags('Proxy Rules')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/proxy-rules')
@UseGuards(ApiKeyGuard)
export class ProxyRulesController {
  constructor(private readonly proxyRulesService: ProxyRulesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Proxy rule details', type: ProxyRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(@Param('id', ParseUUIDPipe) id: string): Promise<ProxyRuleResponseDto> {
    const rule = await this.proxyRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Proxy rule ${id} not found`);
    }
    return rule as ProxyRuleResponseDto;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated proxy rule', type: ProxyRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  @ApiResponse({ status: 409, description: 'Path pattern already exists' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProxyRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ProxyRuleResponseDto> {
    return this.proxyRulesService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
    ) as Promise<ProxyRuleResponseDto>;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a proxy rule' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.proxyRulesService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }
}
