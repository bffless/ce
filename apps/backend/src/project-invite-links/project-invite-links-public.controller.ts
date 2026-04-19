import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProjectInviteLinksService } from './project-invite-links.service';

@ApiTags('Project Invite Links')
@Controller('api/project-invite-links')
export class ProjectInviteLinksPublicController {
  constructor(private readonly inviteLinksService: ProjectInviteLinksService) {}

  @Get(':token/validate')
  @ApiOperation({ summary: 'Validate a project invite link token (public)' })
  async validate(@Param('token') token: string) {
    return this.inviteLinksService.validate(token);
  }
}
