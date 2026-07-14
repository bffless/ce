import { ROLES_KEY } from '../auth/roles.guard';
import { ProjectsController } from './projects.controller';

describe('ProjectsController', () => {
  describe('createProject role gating (#441)', () => {
    const handler = ProjectsController.prototype.createProject;

    it('allows the admin and user global roles (members stay blocked)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['admin', 'user']);
    });

    it('is guarded: handler declares ApiKeyGuard + RolesGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handler) ?? [];
      const guardNames = guards.map((g: any) => g.name);
      expect(guardNames).toEqual(expect.arrayContaining(['ApiKeyGuard', 'RolesGuard']));
    });
  });
});
