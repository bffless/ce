import { FileDeleteHandler } from './file-delete.handler';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { UploadRecordService } from '../upload-record.service';
import { IStorageAdapter } from '../../storage/storage.interface';
import { PipelineContext } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';

describe('FileDeleteHandler', () => {
  const UPLOADS_ROOT = 'o/r/uploads/';

  // evaluateTemplate is a pass-through by default; individual tests can override.
  const buildHandler = (
    storage: Partial<IStorageAdapter>,
    evaluate: (expr: string) => string = (expr) => expr,
  ) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const expressionEvaluator = {
      evaluateTemplate: jest.fn((expr: string) => evaluate(expr)),
    } as unknown as ExpressionEvaluator;
    const uploadRecords = {
      resolveOwnerRepo: jest.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
    } as unknown as UploadRecordService;
    return new FileDeleteHandler(
      registry,
      expressionEvaluator,
      uploadRecords,
      storage as IStorageAdapter,
    );
  };

  const step = (config: Record<string, unknown>): PipelineStep =>
    ({ id: 'delete', name: 'delete', handlerType: 'file_delete', config } as unknown as PipelineStep);

  const context = {} as PipelineContext;

  describe('validateConfig', () => {
    it('rejects when neither prefix nor key is provided', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({})).toThrow(/prefix.*or.*key/i);
    });

    it('rejects when both prefix and key are provided', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefix: 'a/', key: 'a/b' })).toThrow(/exactly one/i);
    });

    it('accepts a single prefix', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefix: 'projects/abc/' })).not.toThrow();
    });
  });

  describe('prefix mode', () => {
    it('deletes every object under the prefix and returns the count', async () => {
      const deletePrefix = jest.fn().mockResolvedValue({ deleted: 7, failed: [] });
      const handler = buildHandler({ deletePrefix });

      const result = await handler.execute(context, step({ prefix: 'projects/abc123/' }));

      // Prefix is resolved against this project's uploads root.
      expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}projects/abc123/`);
      expect(result).toEqual({
        success: true,
        output: { deleted: 7, prefix: 'projects/abc123/', dryRun: false },
      });
    });

    it('is idempotent: a prefix matching nothing returns deleted: 0 with no error', async () => {
      const deletePrefix = jest.fn().mockResolvedValue({ deleted: 0, failed: [] });
      const handler = buildHandler({ deletePrefix });

      const result = await handler.execute(context, step({ prefix: 'projects/missing/' }));

      expect(result).toEqual({
        success: true,
        output: { deleted: 0, prefix: 'projects/missing/', dryRun: false },
      });
    });

    it('surfaces partial deletion failures as an error', async () => {
      const deletePrefix = jest
        .fn()
        .mockResolvedValue({ deleted: 2, failed: ['o/r/uploads/projects/abc/x', 'o/r/uploads/projects/abc/y'] });
      const handler = buildHandler({ deletePrefix });

      await expect(handler.execute(context, step({ prefix: 'projects/abc/' }))).rejects.toThrow(
        /2 failed/,
      );
    });

    it('dryRun lists what would be deleted but deletes nothing', async () => {
      const deletePrefix = jest.fn();
      const listKeys = jest
        .fn()
        .mockResolvedValue(['o/r/uploads/projects/abc/1', 'o/r/uploads/projects/abc/2', 'o/r/uploads/projects/abc/3']);
      const handler = buildHandler({ deletePrefix, listKeys });

      const result = await handler.execute(
        context,
        step({ prefix: 'projects/abc/', dryRun: true }),
      );

      expect(listKeys).toHaveBeenCalledWith(`${UPLOADS_ROOT}projects/abc/`);
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: { deleted: 3, prefix: 'projects/abc/', dryRun: true },
      });
    });

    it('rejects an empty prefix without touching storage', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler({ deletePrefix }, () => '   ');

      await expect(handler.execute(context, step({ prefix: '{{steps.prep.prefix}}' }))).rejects.toThrow(
        /empty/i,
      );
      expect(deletePrefix).not.toHaveBeenCalled();
    });

    it('rejects a "/"-only prefix without touching storage', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler({ deletePrefix }, () => '/');

      await expect(handler.execute(context, step({ prefix: '/' }))).rejects.toThrow(/empty/i);
      expect(deletePrefix).not.toHaveBeenCalled();
    });

    it('rejects a prefix containing ".." without touching storage', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler({ deletePrefix });

      await expect(
        handler.execute(context, step({ prefix: 'projects/../../other/' })),
      ).rejects.toThrow(/traversal/i);
      expect(deletePrefix).not.toHaveBeenCalled();
    });
  });

  describe('key mode', () => {
    it('deletes exactly one existing object', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn().mockResolvedValue(undefined);
      const handler = buildHandler({ exists, delete: del });

      const key = 'projects/abc/source/uuid-file.mov';
      const result = await handler.execute(context, step({ key }));

      expect(exists).toHaveBeenCalledWith(`${UPLOADS_ROOT}${key}`);
      expect(del).toHaveBeenCalledWith(`${UPLOADS_ROOT}${key}`);
      expect(result).toEqual({ success: true, output: { deleted: 1, key, dryRun: false } });
    });

    it('is idempotent: a missing key returns deleted: 0 and does not call delete', async () => {
      const exists = jest.fn().mockResolvedValue(false);
      const del = jest.fn();
      const handler = buildHandler({ exists, delete: del });

      const key = 'projects/abc/gone.mov';
      const result = await handler.execute(context, step({ key }));

      expect(del).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, output: { deleted: 0, key, dryRun: false } });
    });

    it('dryRun reports an existing key as deletable but does not delete', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn();
      const handler = buildHandler({ exists, delete: del });

      const key = 'projects/abc/file.mov';
      const result = await handler.execute(context, step({ key, dryRun: true }));

      expect(del).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, output: { deleted: 1, key, dryRun: true } });
    });

    it('rejects a key containing ".." without touching storage', async () => {
      const del = jest.fn();
      const exists = jest.fn();
      const handler = buildHandler({ exists, delete: del });

      await expect(
        handler.execute(context, step({ key: '../../other/secret.env' })),
      ).rejects.toThrow(/traversal/i);
      expect(exists).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });
  });
});
