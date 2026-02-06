import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { ShareLinksService } from './share-links.service';
import {
  CreateShareLinkDto,
  UpdateShareLinkDto,
  ShareLinkResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@ApiTags('Share Links')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/share-links')
@UseGuards(ApiKeyGuard)
export class ShareLinksController {
  constructor(private readonly shareLinksService: ShareLinksService) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List share links for a project' })
  @ApiParam({ name: 'projectId', type: 'string', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'List of share links',
    type: [ShareLinkResponseDto],
  })
  async getByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ shareLinks: ShareLinkResponseDto[] }> {
    const links = await this.shareLinksService.getByProjectId(projectId);
    return { shareLinks: links as unknown as ShareLinkResponseDto[] };
  }

  @Get('domain/:domainMappingId')
  @ApiOperation({ summary: 'List share links for a domain mapping' })
  @ApiParam({
    name: 'domainMappingId',
    type: 'string',
    description: 'Domain mapping ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of share links',
    type: [ShareLinkResponseDto],
  })
  async getByDomain(
    @Param('domainMappingId', ParseUUIDPipe) domainMappingId: string,
  ): Promise<{ shareLinks: ShareLinkResponseDto[] }> {
    const links =
      await this.shareLinksService.getByDomainMappingId(domainMappingId);
    return { shareLinks: links as unknown as ShareLinkResponseDto[] };
  }

  @Post()
  @ApiOperation({ summary: 'Create a share link' })
  @ApiResponse({
    status: 201,
    description: 'Share link created',
    type: ShareLinkResponseDto,
  })
  async create(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ShareLinkResponseDto> {
    const link = await this.shareLinksService.create(dto, user.id);
    return link as unknown as ShareLinkResponseDto;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a share link' })
  @ApiParam({ name: 'id', type: 'string', description: 'Share link ID' })
  @ApiResponse({
    status: 200,
    description: 'Share link updated',
    type: ShareLinkResponseDto,
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShareLinkDto,
  ): Promise<ShareLinkResponseDto> {
    const link = await this.shareLinksService.update(id, dto);
    return link as unknown as ShareLinkResponseDto;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a share link' })
  @ApiParam({ name: 'id', type: 'string', description: 'Share link ID' })
  @ApiResponse({ status: 200, description: 'Share link deleted' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    await this.shareLinksService.delete(id);
    return { success: true };
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'Regenerate share link token' })
  @ApiParam({ name: 'id', type: 'string', description: 'Share link ID' })
  @ApiResponse({
    status: 200,
    description: 'Share link token regenerated',
    type: ShareLinkResponseDto,
  })
  async regenerateToken(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShareLinkResponseDto> {
    const link = await this.shareLinksService.regenerateToken(id);
    return link as unknown as ShareLinkResponseDto;
  }
}
