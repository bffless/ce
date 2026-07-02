import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
// Import from the concrete files (not the ../auth barrel): the barrel pulls in
// auth.module -> settings.module, a cycle that leaves Roles undefined when this
// controller is loaded first (e.g. in unit tests).
import { ApiKeyGuard } from '../auth/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BlocklistService } from './blocklist.service';
import {
  AppendBlocklistEntryDto,
  CreateBlocklistDto,
  SyncDomainBlocklistsDto,
  UpdateBlocklistDto,
  UpdateBlocklistSettingsDto,
} from './blocklist.dto';

/**
 * The Blocklist library + bot-protection settings + per-domain attachment
 * (issues #391/#393), admin-only like the rest of /api/traffic. Mutations here
 * rebuild the app-side enforcement matchers immediately and trigger edge
 * (nginx) config regeneration when the effective set changed.
 */
@ApiTags('Traffic')
@Controller('api/traffic')
@UseGuards(ApiKeyGuard, RolesGuard)
export class BlocklistsController {
  constructor(private readonly blocklistService: BlocklistService) {}

  @Get('blocklist-settings')
  @Roles('admin')
  @ApiOperation({ summary: 'Bot-protection settings: master toggle + Baseline size (admin only)' })
  async getSettings() {
    return this.blocklistService.getSettings();
  }

  @Patch('blocklist-settings')
  @Roles('admin')
  @ApiOperation({ summary: 'Flip the bot-protection master toggle (admin only)' })
  async updateSettings(@Body() dto: UpdateBlocklistSettingsDto) {
    return this.blocklistService.setEnabled(dto.enabled);
  }

  @Get('blocklists/baseline')
  @Roles('admin')
  @ApiOperation({ summary: 'The code-shipped Baseline scanner signatures, read-only (admin only)' })
  getBaseline() {
    return { entries: this.blocklistService.getBaselineEntries() };
  }

  @Get('blocklists')
  @Roles('admin')
  @ApiOperation({ summary: 'List all Blocklists with their patterns (admin only)' })
  async list() {
    return this.blocklistService.listBlocklists();
  }

  @Post('blocklists')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a Blocklist (admin only)' })
  async create(@Body() dto: CreateBlocklistDto) {
    return this.blocklistService.createBlocklist(dto);
  }

  @Get('blocklists/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get one Blocklist (admin only)' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blocklistService.getBlocklist(id);
  }

  @Patch('blocklists/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a Blocklist; entries/allowlist replace wholesale (admin only)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlocklistDto) {
    return this.blocklistService.updateBlocklist(id, dto);
  }

  @Delete('blocklists/:id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a Blocklist (admin only)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.blocklistService.deleteBlocklist(id);
  }

  @Post('blocklists/:id/entries')
  @Roles('admin')
  @ApiOperation({ summary: 'Append one block pattern (inline add-to-blocklist, admin only)' })
  async appendEntry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AppendBlocklistEntryDto) {
    return this.blocklistService.appendEntry(id, dto);
  }

  @Get('domains/:domainMappingId/blocklists')
  @Roles('admin')
  @ApiOperation({ summary: 'Blocklist ids attached to a domain mapping (admin only)' })
  async getDomainBlocklists(@Param('domainMappingId', ParseUUIDPipe) domainMappingId: string) {
    return {
      domainMappingId,
      blocklistIds: await this.blocklistService.getDomainBlocklistIds(domainMappingId),
    };
  }

  @Put('domains/:domainMappingId/blocklists')
  @Roles('admin')
  @ApiOperation({ summary: 'Replace the Blocklists attached to a domain mapping (admin only)' })
  async syncDomainBlocklists(
    @Param('domainMappingId', ParseUUIDPipe) domainMappingId: string,
    @Body() dto: SyncDomainBlocklistsDto,
  ) {
    return this.blocklistService.syncDomainBlocklists(domainMappingId, dto.blocklistIds);
  }
}
