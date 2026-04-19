import { Module, forwardRef } from '@nestjs/common';
import { ProjectInviteLinksService } from './project-invite-links.service';
import { ProjectInviteLinksController } from './project-invite-links.controller';
import { ProjectInviteLinksPublicController } from './project-invite-links-public.controller';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [forwardRef(() => ProjectsModule), forwardRef(() => PermissionsModule)],
  controllers: [ProjectInviteLinksController, ProjectInviteLinksPublicController],
  providers: [ProjectInviteLinksService],
  exports: [ProjectInviteLinksService],
})
export class ProjectInviteLinksModule {}
