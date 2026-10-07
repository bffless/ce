import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { PipelineDataIndexesService } from './pipeline-data-indexes.service';
import { PermissionsService } from '../permissions/permissions.service';
import { db } from '../db/client';

jest.mock('../db/client', () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));

/**
 * The schema service keeps the per-field indexes in step with the fields it writes
 * (`PipelineDataIndexesService.reconcile`): on create, on an update that changes the
 * fields, on the sync's index adoption, and dropped with the schema. Refuses
 * `indexed` on a type that cannot be indexed.
 */
describe('PipelineSchemasService — field indexes', () => {
  let service: PipelineSchemasService;
  const indexes = {
    reconcile: jest.fn().mockResolvedValue({ create: [], drop: [], wanted: [] }),
    dropAll: jest.fn().mockResolvedValue(undefined),
  };
  const mockDb = db as unknown as {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  const schema = (fields: unknown[], version = 3) => ({
    id: 'schema-1',
    projectId: 'project-1',
    name: 'runs',
    fields,
    version,
    kind: null,
    source: null,
  });

  const selectReturning = (rows: unknown[]) =>
    mockDb.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => rows }) }) });
  const insertReturning = (row: unknown) =>
    mockDb.insert.mockReturnValue({ values: () => ({ returning: async () => [row] }) });
  const updateReturning = (row: unknown | undefined) =>
    mockDb.update.mockReturnValue({
      set: () => ({ where: () => ({ returning: async () => (row ? [row] : []) }) }),
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PipelineSchemasService,
        { provide: PipelineDataIndexesService, useValue: indexes },
        { provide: PermissionsService, useValue: { requireProjectAccess: jest.fn() } },
      ],
    }).compile();
    service = module.get(PipelineSchemasService);
  });

  it("create: reconciles the new schema's indexes with the fields as stored", async () => {
    selectReturning([]);
    const stored = schema([{ name: 'runId', type: 'string', required: true, indexed: true }]);
    insertReturning(stored);
    await service.create(
      {
        projectId: 'project-1',
        name: 'runs',
        fields: [{ name: 'runId', type: 'string', required: true, indexed: true }],
      },
      'u',
      'admin',
    );
    expect(indexes.reconcile).toHaveBeenCalledWith('schema-1', stored.fields);
  });

  it('create: refuses indexed on a text or json field, before anything is written', async () => {
    selectReturning([]);
    await expect(
      service.create(
        {
          projectId: 'project-1',
          name: 'runs',
          fields: [{ name: 'notes', type: 'text', required: false, indexed: true }],
        },
        'u',
        'admin',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(indexes.reconcile).not.toHaveBeenCalled();
  });

  it('update: reconciles only when the fields change', async () => {
    const live = schema([{ name: 'runId', type: 'string', required: true }]);
    selectReturning([live]);
    updateReturning({ ...live, name: 'runs2' });
    await service.update('schema-1', { name: 'runs2' }, 'u', 'admin');
    expect(indexes.reconcile).not.toHaveBeenCalled();

    const changed = schema([{ name: 'runId', type: 'string', required: true, indexed: true }], 4);
    updateReturning(changed);
    await service.update(
      'schema-1',
      { fields: [{ name: 'runId', type: 'string', required: true, indexed: true }] },
      'u',
      'admin',
    );
    expect(indexes.reconcile).toHaveBeenCalledWith('schema-1', changed.fields);
  });

  it('adoptIndexes: sets the flags the sync asks for, conditioned on the version it read, and reconciles', async () => {
    const live = schema([
      { name: 'runId', type: 'string', required: true },
      { name: 'key', type: 'string', required: false, indexed: true },
    ]);
    selectReturning([live]);
    const after = schema([
      { name: 'runId', type: 'string', required: true, indexed: true },
      { name: 'key', type: 'string', required: false },
    ]);
    updateReturning(after);
    await expect(service.adoptIndexes('schema-1', ['runId'])).resolves.toEqual(['runId']);
    expect(indexes.reconcile).toHaveBeenCalledWith('schema-1', after.fields);
  });

  it('adoptIndexes: a version race is a 409, after one more try', async () => {
    const live = schema([{ name: 'runId', type: 'string', required: true }]);
    selectReturning([live]);
    updateReturning(undefined);
    await expect(service.adoptIndexes('schema-1', ['runId'])).rejects.toThrow(ConflictException);
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(indexes.reconcile).not.toHaveBeenCalled();
  });

  it("delete: drops the schema's indexes with it", async () => {
    selectReturning([schema([])]);
    mockDb.delete.mockReturnValue({ where: async () => undefined });
    await service.delete('schema-1', 'u', 'admin');
    expect(indexes.dropAll).toHaveBeenCalledWith('schema-1');
  });
});
