import 'reflect-metadata';
import { UserGroupsModule } from './user-groups.module';
import { UserGroupsController } from './user-groups.controller';
import { UserGroupsDirectoryController } from './user-groups-directory.controller';

describe('UserGroupsModule', () => {
  it(
    'registers the member-accessible directory controller BEFORE the admin ' +
      "controller, so its static /directory and /mine routes aren't swallowed " +
      "by UserGroupsController's @Get(':id')",
    () => {
      const controllers = Reflect.getMetadata('controllers', UserGroupsModule) as unknown[];

      expect(controllers).toBeDefined();

      const directoryIndex = controllers.indexOf(UserGroupsDirectoryController);
      const adminIndex = controllers.indexOf(UserGroupsController);

      expect(directoryIndex).toBeGreaterThanOrEqual(0);
      expect(adminIndex).toBeGreaterThanOrEqual(0);
      expect(directoryIndex).toBeLessThan(adminIndex);
    },
  );
});
