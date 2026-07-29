import { Module } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service';
import { UserGroupsController } from './user-groups.controller';
import { UserGroupsDirectoryController } from './user-groups-directory.controller';

@Module({
  // Order matters: Nest registers routes in this array's order, and
  // UserGroupsController has @Get(':id'). UserGroupsDirectoryController's
  // static /directory and /mine paths MUST be listed first, or ':id'
  // swallows them (id === 'directory') and non-admins get a 403 from the
  // admin-only controller instead of reaching the member-accessible one.
  controllers: [UserGroupsDirectoryController, UserGroupsController],
  providers: [UserGroupsService],
  exports: [UserGroupsService],
})
export class UserGroupsModule {}
