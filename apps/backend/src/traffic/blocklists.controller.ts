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
import { CreateBlocklistDto, UpdateBlocklistDto, UpdateBlocklistSettingsDto } from './blocklist.dto';

/**
 * The Blocklist library + bot-protection settings (issue #391), admin-only
 * like the rest of /api/traffic. CRUD here rebuilds the app-side enforcement
 * matcher immediately; edge (nginx) enforcement rides on top in #392.
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
}
