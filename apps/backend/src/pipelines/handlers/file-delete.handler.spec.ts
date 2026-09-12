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
  // resolveExpr backs evaluateExpression — used by the `keys`-as-expression mode
  // to resolve a single expression to its runtime value (e.g. an array).
  const buildHandler = (
    storage: Partial<IStorageAdapter>,
    evaluate: (expr: string) => string = (expr) => expr,
    resolveExpr: (expr: string) => unknown = (expr) => expr,
  ) => {
    const registry = { register: jest.fn() } as unknown as StepHandlerRegistry;
    const expressionEvaluator = {
      evaluateTemplate: jest.fn((expr: string) => evaluate(expr)),
      evaluateExpression: jest.fn((expr: string) => resolveExpr(expr)),
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
    ({
      id: 'delete',
      name: 'delete',
      handlerType: 'file_delete',
      config,
    }) as unknown as PipelineStep;

  const context = {} as PipelineContext;

  describe('validateConfig', () => {
    it('rejects when none of prefix, key, keys, or prefixes is provided', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({})).toThrow(
        /one of "prefix", "key", "keys", or "prefixes" is required/i,
      );
    });

    it('rejects when both prefix and key are provided', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefix: 'a/', key: 'a/b' })).toThrow(/exactly one/i);
    });

    it('accepts a single prefix', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefix: 'projects/abc/' })).not.toThrow();
    });

    it('accepts a non-empty keys array', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: ['a/b', 'c/d'] })).not.toThrow();
    });

    it('accepts keys as an expression string (resolved at runtime)', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: 'steps.siteKeys.list' })).not.toThrow();
    });

    it('rejects a blank keys expression string', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: '   ' })).toThrow(/non-empty/i);
    });

    it('rejects keys that is neither an array nor a string', () => {
      const handler = buildHandler({});
      expect(() =>
        handler.validateConfig({ keys: { not: 'valid' } as unknown as string[] }),
      ).toThrow(/array of strings or an expression string/i);
    });

    it('rejects keys combined with key', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: ['a/b'], key: 'c/d' })).toThrow(/exactly one/i);
    });

    it('rejects keys combined with prefix', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: ['a/b'], prefix: 'c/' })).toThrow(/exactly one/i);
    });

    it('rejects an empty keys array', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: [] })).toThrow(
        /keys.*non-empty|non-empty.*keys/i,
      );
    });

    it('rejects a keys array containing a non-string entry', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ keys: ['a/b', 123 as unknown as string] })).toThrow(
        /string/i,
      );
    });

    it('accepts a non-empty prefixes array', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: ['runs/a/', 'runs/b/'] })).not.toThrow();
    });

    it('accepts prefixes as an expression string (resolved at runtime)', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: 'steps.cutoff.prefixes' })).not.toThrow();
    });

    it('rejects a blank prefixes expression string', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: '   ' })).toThrow(/non-empty/i);
    });

    it('rejects an empty prefixes array', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: [] })).toThrow(
        /prefixes.*non-empty|non-empty.*prefixes/i,
      );
    });

    it('rejects a prefixes array containing a blank or non-string entry', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: ['runs/a/', ''] })).toThrow(/non-empty/i);
      expect(() =>
        handler.validateConfig({ prefixes: ['runs/a/', 7 as unknown as string] }),
      ).toThrow(/string/i);
    });

    it('rejects prefixes that is neither an array nor a string', () => {
      const handler = buildHandler({});
      expect(() =>
        handler.validateConfig({ prefixes: { not: 'valid' } as unknown as string[] }),
      ).toThrow(/array of strings or an expression string/i);
    });

    it('rejects prefixes combined with prefix, key, or keys', () => {
      const handler = buildHandler({});
      expect(() => handler.validateConfig({ prefixes: ['a/'], prefix: 'b/' })).toThrow(
        /exactly one/i,
      );
      expect(() => handler.validateConfig({ prefixes: ['a/'], key: 'b/c' })).toThrow(
        /exactly one/i,
      );
      expect(() => handler.validateConfig({ prefixes: ['a/'], keys: ['b/c'] })).toThrow(
        /exactly one/i,
      );
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
      const deletePrefix = jest.fn().mockResolvedValue({
        deleted: 2,
        failed: ['o/r/uploads/projects/abc/x', 'o/r/uploads/projects/abc/y'],
      });
      const handler = buildHandler({ deletePrefix });

      await expect(handler.execute(context, step({ prefix: 'projects/abc/' }))).rejects.toThrow(
        /2 failed/,
      );
    });

    it('dryRun lists what would be deleted but deletes nothing', async () => {
      const deletePrefix = jest.fn();
      const listKeys = jest
        .fn()
        .mockResolvedValue([
          'o/r/uploads/projects/abc/1',
          'o/r/uploads/projects/abc/2',
          'o/r/uploads/projects/abc/3',
        ]);
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

      await expect(
        handler.execute(context, step({ prefix: '{{steps.prep.prefix}}' })),
      ).rejects.toThrow(/empty/i);
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

  describe('keys mode', () => {
    it('deletes each existing key and returns the count', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn().mockResolvedValue(undefined);
      const handler = buildHandler({ exists, delete: del });

      const keys = ['projects/abc/a.mov', 'projects/abc/b.png', 'projects/abc/c.css'];
      const result = await handler.execute(context, step({ keys }));

      keys.forEach((k) => expect(del).toHaveBeenCalledWith(`${UPLOADS_ROOT}${k}`));
      expect(del).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        success: true,
        output: { deleted: 3, keys, dryRun: false },
      });
    });

    it('is idempotent: missing keys are skipped and only existing keys count', async () => {
      const present = new Set([`${UPLOADS_ROOT}projects/abc/here.mov`]);
      const exists = jest.fn((k: string) => Promise.resolve(present.has(k)));
      const del = jest.fn().mockResolvedValue(undefined);
      const handler = buildHandler({ exists, delete: del });

      const keys = ['projects/abc/here.mov', 'projects/abc/gone.mov'];
      const result = await handler.execute(context, step({ keys }));

      expect(del).toHaveBeenCalledTimes(1);
      expect(del).toHaveBeenCalledWith(`${UPLOADS_ROOT}projects/abc/here.mov`);
      expect(result).toEqual({
        success: true,
        output: { deleted: 1, keys, dryRun: false },
      });
    });

    it('dryRun counts existing keys but deletes nothing', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn();
      const handler = buildHandler({ exists, delete: del });

      const keys = ['projects/abc/a.mov', 'projects/abc/b.png'];
      const result = await handler.execute(context, step({ keys, dryRun: true }));

      expect(del).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: { deleted: 2, keys, dryRun: true },
      });
    });

    it('interpolates each key expression against the uploads root', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn().mockResolvedValue(undefined);
      const handler = buildHandler({ exists, delete: del }, (expr) =>
        expr.replace('{{hash}}', 'deadbeef'),
      );

      const result = await handler.execute(context, step({ keys: ['content/{{hash}}'] }));

      expect(del).toHaveBeenCalledWith(`${UPLOADS_ROOT}content/deadbeef`);
      expect(result).toEqual({
        success: true,
        output: { deleted: 1, keys: ['content/deadbeef'], dryRun: false },
      });
    });

    it('surfaces partial deletion failures as an error reporting the count', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn((k: string) => {
        if (k.endsWith('b.png')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve(undefined);
      });
      const handler = buildHandler({ exists, delete: del });

      const keys = ['projects/abc/a.mov', 'projects/abc/b.png', 'projects/abc/c.css'];
      await expect(handler.execute(context, step({ keys }))).rejects.toThrow(/1 failed/);
    });

    it('rejects a keys entry containing ".." before any storage call', async () => {
      const exists = jest.fn();
      const del = jest.fn();
      const handler = buildHandler({ exists, delete: del });

      await expect(
        handler.execute(context, step({ keys: ['projects/abc/ok', '../../secret.env'] })),
      ).rejects.toThrow(/traversal/i);
      expect(exists).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('rejects a keys entry that resolves to blank before any storage call', async () => {
      const exists = jest.fn();
      const del = jest.fn();
      const handler = buildHandler({ exists, delete: del }, (expr) =>
        expr === '{{blank}}' ? '   ' : expr,
      );

      await expect(
        handler.execute(context, step({ keys: ['projects/abc/ok', '{{blank}}'] })),
      ).rejects.toThrow(/empty/i);
      expect(exists).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });
  });

  // `keys` given as a SINGLE expression string that resolves to an array at
  // runtime — the dynamic, variable-length case a static array can't express
  // (e.g. a Site manifest's object keys, computed by a prior step).
  describe('keys expression mode', () => {
    const KEYS_EXPR = 'steps.siteKeys.list';

    it('resolves the expression to an array and deletes each key', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const del = jest.fn().mockResolvedValue(undefined);
      const resolved = ['content/aaa', 'content/bbb', 'content/ccc'];
      const handler = buildHandler(
        { exists, delete: del },
        (expr) => expr,
        (expr) => (expr === KEYS_EXPR ? resolved : expr),
      );

      const result = await handler.execute(context, step({ keys: KEYS_EXPR }));

      resolved.forEach((k) => expect(del).toHaveBeenCalledWith(`${UPLOADS_ROOT}${k}`));
      expect(del).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        success: true,
        output: { deleted: 3, keys: resolved, dryRun: false },
      });
    });

    it('treats a resolved empty array as a no-op (deleted: 0, no storage calls)', async () => {
      const exists = jest.fn();
      const del = jest.fn();
      const handler = buildHandler(
        { exists, delete: del },
        (expr) => expr,
        () => [],
      );

      const result = await handler.execute(context, step({ keys: KEYS_EXPR }));

      expect(exists).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: { deleted: 0, keys: [], dryRun: false },
      });
    });

    it('throws when the expression resolves to a non-array', async () => {
      const handler = buildHandler(
        { exists: jest.fn(), delete: jest.fn() },
        (expr) => expr,
        () => 'not-an-array',
      );
      await expect(handler.execute(context, step({ keys: KEYS_EXPR }))).rejects.toThrow(
        /must resolve to an array/i,
      );
    });

    it('throws when the resolved array contains a non-string entry', async () => {
      const handler = buildHandler(
        { exists: jest.fn(), delete: jest.fn() },
        (expr) => expr,
        () => ['content/ok', 42],
      );
      await expect(handler.execute(context, step({ keys: KEYS_EXPR }))).rejects.toThrow(
        /array of strings/i,
      );
    });

    it('still guards each resolved key against traversal before any storage call', async () => {
      const exists = jest.fn();
      const del = jest.fn();
      const handler = buildHandler(
        { exists, delete: del },
        (expr) => expr,
        () => ['content/ok', '../../secret.env'],
      );

      await expect(handler.execute(context, step({ keys: KEYS_EXPR }))).rejects.toThrow(
        /traversal/i,
      );
      expect(exists).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });
  });

  // `prefixes` — many "folders" in one step, each a list+delete like `prefix`.
  describe('prefixes mode', () => {
    it('deletes everything under each prefix and returns the summed count', async () => {
      const deletePrefix = jest.fn((full: string) =>
        Promise.resolve({ deleted: full.endsWith('a/') ? 3 : 4, failed: [] }),
      );
      const handler = buildHandler({ deletePrefix });

      const prefixes = ['runs/a/', 'runs/b/'];
      const result = await handler.execute(context, step({ prefixes }));

      expect(deletePrefix).toHaveBeenCalledTimes(2);
      expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/a/`);
      expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/b/`);
      expect(result).toEqual({
        success: true,
        output: { deleted: 7, prefixes, dryRun: false },
      });
    });

    it('is idempotent: prefixes matching nothing contribute 0 with no error', async () => {
      const deletePrefix = jest.fn().mockResolvedValue({ deleted: 0, failed: [] });
      const handler = buildHandler({ deletePrefix });

      const prefixes = ['runs/gone-1/', 'runs/gone-2/'];
      const result = await handler.execute(context, step({ prefixes }));

      expect(result).toEqual({
        success: true,
        output: { deleted: 0, prefixes, dryRun: false },
      });
    });

    it('interpolates each prefix template against the uploads root', async () => {
      const deletePrefix = jest.fn().mockResolvedValue({ deleted: 1, failed: [] });
      const handler = buildHandler({ deletePrefix }, (expr) =>
        expr.replace('{{steps.a.id}}', 'r1').replace('{{steps.b.id}}', 'r2'),
      );

      const result = await handler.execute(
        context,
        step({ prefixes: ['runs/{{steps.a.id}}/', 'runs/{{steps.b.id}}/'] }),
      );

      expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/r1/`);
      expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/r2/`);
      expect(result).toEqual({
        success: true,
        output: { deleted: 2, prefixes: ['runs/r1/', 'runs/r2/'], dryRun: false },
      });
    });

    it('dryRun lists each prefix, sums the counts, and deletes nothing', async () => {
      const deletePrefix = jest.fn();
      const listKeys = jest.fn((full: string) =>
        Promise.resolve(full.endsWith('a/') ? ['x', 'y'] : ['z']),
      );
      const handler = buildHandler({ deletePrefix, listKeys });

      const prefixes = ['runs/a/', 'runs/b/'];
      const result = await handler.execute(context, step({ prefixes, dryRun: true }));

      expect(listKeys).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/a/`);
      expect(listKeys).toHaveBeenCalledWith(`${UPLOADS_ROOT}runs/b/`);
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: { deleted: 3, prefixes, dryRun: true },
      });
    });

    it('surfaces per-object failures as an error reporting the summed count', async () => {
      const deletePrefix = jest.fn((full: string) =>
        Promise.resolve(
          full.endsWith('b/')
            ? { deleted: 1, failed: [`${full}stuck`] }
            : { deleted: 2, failed: [] },
        ),
      );
      const handler = buildHandler({ deletePrefix });

      await expect(
        handler.execute(context, step({ prefixes: ['runs/a/', 'runs/b/', 'runs/c/'] })),
      ).rejects.toThrow(/Deleted 5 object\(s\) across 3 prefix\(es\) but 1 failed/);
      // Every prefix is still attempted; one failing prefix does not stop the rest.
      expect(deletePrefix).toHaveBeenCalledTimes(3);
    });

    it('treats a prefix whose deletion throws as failed and still processes the rest', async () => {
      const deletePrefix = jest.fn((full: string) =>
        full.endsWith('b/')
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ deleted: 2, failed: [] }),
      );
      const handler = buildHandler({ deletePrefix });

      await expect(
        handler.execute(context, step({ prefixes: ['runs/a/', 'runs/b/', 'runs/c/'] })),
      ).rejects.toThrow(/4 object\(s\).*1 failed/);
      expect(deletePrefix).toHaveBeenCalledTimes(3);
    });

    it('rejects a prefixes entry containing ".." before any storage call', async () => {
      const deletePrefix = jest.fn();
      const listKeys = jest.fn();
      const handler = buildHandler({ deletePrefix, listKeys });

      await expect(
        handler.execute(context, step({ prefixes: ['runs/ok/', 'runs/../../other/'] })),
      ).rejects.toThrow(/traversal/i);
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(listKeys).not.toHaveBeenCalled();
    });

    it('rejects a prefixes entry that resolves to blank before any storage call', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler({ deletePrefix }, (expr) =>
        expr === '{{blank}}' ? '   ' : expr,
      );

      await expect(
        handler.execute(context, step({ prefixes: ['runs/ok/', '{{blank}}'] })),
      ).rejects.toThrow(/empty/i);
      expect(deletePrefix).not.toHaveBeenCalled();
    });

    it('rejects a prefixes entry that resolves to "/" before any storage call', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler({ deletePrefix }, (expr) => (expr === '{{root}}' ? '/' : expr));

      await expect(
        handler.execute(context, step({ prefixes: ['runs/ok/', '{{root}}'] })),
      ).rejects.toThrow(/empty/i);
      expect(deletePrefix).not.toHaveBeenCalled();
    });
  });

  // `prefixes` given as a SINGLE expression string that resolves to an array at
  // runtime — e.g. a prior step computing every run prefix past a retention cutoff.
  describe('prefixes expression mode', () => {
    const PREFIXES_EXPR = 'steps.cutoff.prefixes';

    it('resolves the expression to an array and deletes under each prefix', async () => {
      const deletePrefix = jest.fn().mockResolvedValue({ deleted: 2, failed: [] });
      const resolved = ['workflows/w/runs/r1/', 'workflows/w/runs/r2/', 'workflows/w/runs/r3/'];
      const handler = buildHandler(
        { deletePrefix },
        (expr) => expr,
        (expr) => (expr === PREFIXES_EXPR ? resolved : expr),
      );

      const result = await handler.execute(context, step({ prefixes: PREFIXES_EXPR }));

      resolved.forEach((p) => expect(deletePrefix).toHaveBeenCalledWith(`${UPLOADS_ROOT}${p}`));
      expect(deletePrefix).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        success: true,
        output: { deleted: 6, prefixes: resolved, dryRun: false },
      });
    });

    it('treats a resolved empty array as a no-op (deleted: 0, no storage calls)', async () => {
      const deletePrefix = jest.fn();
      const listKeys = jest.fn();
      const handler = buildHandler(
        { deletePrefix, listKeys },
        (expr) => expr,
        () => [],
      );

      const result = await handler.execute(context, step({ prefixes: PREFIXES_EXPR }));

      expect(deletePrefix).not.toHaveBeenCalled();
      expect(listKeys).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: { deleted: 0, prefixes: [], dryRun: false },
      });
    });

    it('throws when the expression resolves to a non-array', async () => {
      const handler = buildHandler(
        { deletePrefix: jest.fn() },
        (expr) => expr,
        () => 'runs/only-one/',
      );
      await expect(handler.execute(context, step({ prefixes: PREFIXES_EXPR }))).rejects.toThrow(
        /"prefixes" expression .* must resolve to an array/i,
      );
    });

    it('throws when the resolved array contains a non-string entry', async () => {
      const handler = buildHandler(
        { deletePrefix: jest.fn() },
        (expr) => expr,
        () => ['runs/ok/', 42],
      );
      await expect(handler.execute(context, step({ prefixes: PREFIXES_EXPR }))).rejects.toThrow(
        /array of strings/i,
      );
    });

    it('still guards each resolved prefix against traversal before any storage call', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler(
        { deletePrefix },
        (expr) => expr,
        () => ['runs/ok/', '../../other/'],
      );

      await expect(handler.execute(context, step({ prefixes: PREFIXES_EXPR }))).rejects.toThrow(
        /traversal/i,
      );
      expect(deletePrefix).not.toHaveBeenCalled();
    });

    it('still refuses a resolved blank entry before any storage call', async () => {
      const deletePrefix = jest.fn();
      const handler = buildHandler(
        { deletePrefix },
        (expr) => expr,
        () => ['runs/ok/', ''],
      );

      await expect(handler.execute(context, step({ prefixes: PREFIXES_EXPR }))).rejects.toThrow(
        /empty/i,
      );
      expect(deletePrefix).not.toHaveBeenCalled();
    });
  });
});
