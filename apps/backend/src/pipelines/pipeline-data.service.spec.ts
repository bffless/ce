import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PipelineDataService } from './pipeline-data.service';
import { PermissionsService } from '../permissions/permissions.service';
import { db } from '../db/client';

jest.mock('../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('PipelineDataService — api-key project scoping', () => {
  let service: PipelineDataService;
  let permissionsService: PermissionsService;

  const recordOwningProject = 'project-A';
  const otherProject = 'project-B';
  const recordId = 'record-1';
  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineDataService,
        {
          provide: PermissionsService,
          useValue: {
            requireProjectAccess: jest.fn(),
            getUserProjectRole: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PipelineDataService);
    permissionsService = module.get(PermissionsService);
    jest.clearAllMocks();
  });

  describe('update', () => {
    beforeEach(() => {
      // Stub: getById finds a record owned by `recordOwningProject`
      (db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValue([{ id: recordId, projectId: recordOwningProject, data: {} }]),
      });
      // Stub: db.update().set().where().returning() returns updated row
      (db.update as jest.Mock).mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest
          .fn()
          .mockResolvedValue([{ id: recordId, projectId: recordOwningProject, data: { x: 1 } }]),
      });
    });

    it('passes the api-key scope through to PermissionsService.requireProjectAccess', async () => {
      await service.update(recordId, { x: 1 }, userId, 'user', recordOwningProject);

      expect(permissionsService.requireProjectAccess).toHaveBeenCalledWith(
        recordOwningProject,
        userId,
        'user',
        'contributor',
        recordOwningProject,
      );
    });

    it('rejects when the api-key is scoped to a different project (helper throws)', async () => {
      (permissionsService.requireProjectAccess as jest.Mock).mockRejectedValueOnce(
        new ForbiddenException('API key is not authorized for this project'),
      );

      await expect(
        service.update(recordId, { x: 1 }, userId, 'admin', otherProject),
      ).rejects.toThrow(ForbiddenException);
    });

    it('proceeds normally when no api-key scope is present (session auth)', async () => {
      await expect(
        service.update(recordId, { x: 1 }, userId, 'user'),
      ).resolves.toBeDefined();

      expect(permissionsService.requireProjectAccess).toHaveBeenCalledWith(
        recordOwningProject,
        userId,
        'user',
        'contributor',
        undefined,
      );
    });
  });
});
