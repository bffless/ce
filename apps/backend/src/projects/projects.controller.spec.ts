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

  // The skills picker in the pipeline editor lists what a *step's* path resolves
  // to. Without these overrides it would answer from the project-wide setting,
  // so an author typing a per-step path would see a stale (usually empty) list
  // with no clue why — the same silent miss that made this bug hard to spot.
  describe('listSkills source overrides', () => {
    function createController(overrides: Record<string, unknown> = {}) {
      const skillsService = { listSkills: jest.fn().mockResolvedValue([]) };
      const aiSettingsService = {
        resolveSkillsCommitSha: jest.fn().mockResolvedValue('sha-project'),
        getSkillsPath: jest.fn().mockResolvedValue('.bffless/skills'),
        ...overrides,
      };
      const projectsService = {
        getProjectById: jest.fn().mockResolvedValue({ owner: 'bffless', name: 'studio' }),
      };
      const controller = new ProjectsController(
        projectsService as never,
        aiSettingsService as never,
        {} as never,
        skillsService as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { controller, skillsService, aiSettingsService };
    }

    it('lists from the requested path instead of the project setting', async () => {
      const { controller, skillsService } = createController();

      await controller.listSkills('proj-1', undefined, 'apps/studio/dist/bffless/skills');

      expect(skillsService.listSkills).toHaveBeenCalledWith(
        'bffless',
        'studio',
        'sha-project',
        'apps/studio/dist/bffless/skills',
      );
    });

    it('resolves the commit SHA from the requested alias', async () => {
      const { controller, aiSettingsService } = createController();

      await controller.listSkills('proj-1', undefined, undefined, 'skills-only');

      expect(aiSettingsService.resolveSkillsCommitSha).toHaveBeenCalledWith(
        'proj-1',
        undefined,
        'skills-only',
      );
    });

    it('falls back to the project path when no override is given', async () => {
      const { controller, skillsService } = createController();

      await controller.listSkills('proj-1');

      expect(skillsService.listSkills).toHaveBeenCalledWith(
        'bffless',
        'studio',
        'sha-project',
        '.bffless/skills',
      );
    });
  });
});
