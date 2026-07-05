import { UploadRecordService } from './upload-record.service';
import { ExpressionEvaluator } from './execution/expression-evaluator';
import { PipelineDataService } from './pipeline-data.service';
import { PipelineContext } from './execution/pipeline-context.interface';

describe('UploadRecordService.resolveSubDir', () => {
  // Build a service with a real ExpressionEvaluator so {{...}} interpolation is
  // exercised end-to-end against a pipeline context.
  const build = () => {
    const dataService = {} as PipelineDataService;
    const evaluator = new ExpressionEvaluator();
    return new UploadRecordService(dataService, evaluator);
  };

  // The evaluator maps request.body -> context.metadata.body and reads steps
  // from context.stepOutputs.
  const contextWith = (body: Record<string, unknown>): PipelineContext =>
    ({ metadata: { body }, stepOutputs: {} } as unknown as PipelineContext);

  it('passes a static subDir through unchanged (backward compatible)', () => {
    const svc = build();
    expect(svc.resolveSubDir('images', contextWith({}), 'upload')).toBe('images');
  });

  it('interpolates an expression for per-project layouts', () => {
    const svc = build();
    const result = svc.resolveSubDir(
      'projects/{{request.body.projectId}}',
      contextWith({ projectId: 'abc123' }),
      'upload',
    );
    expect(result).toBe('projects/abc123');
  });

  it('trims leading and trailing slashes', () => {
    const svc = build();
    expect(svc.resolveSubDir('/images/', contextWith({}), 'upload')).toBe('images');
  });

  it('rejects an expression that resolves to empty', () => {
    const svc = build();
    expect(() =>
      svc.resolveSubDir('{{request.body.missing}}', contextWith({}), 'upload'),
    ).toThrow(/empty/i);
  });

  it('rejects a whitespace-only result', () => {
    const svc = build();
    expect(() => svc.resolveSubDir('   ', contextWith({}), 'upload')).toThrow(/empty/i);
  });

  it('rejects a ".." traversal in the resolved value', () => {
    const svc = build();
    expect(() =>
      svc.resolveSubDir(
        'projects/{{request.body.projectId}}',
        contextWith({ projectId: '../../other' }),
        'upload',
      ),
    ).toThrow(/traversal/i);
  });
});

describe('UploadRecordService.buildUploadKey — verbatim mode', () => {
  const build = () =>
    new UploadRecordService({} as PipelineDataService, new ExpressionEvaluator());
  const base = { owner: 'acme', repo: 'site', subDir: 'content', originalName: 'ignored.md' };

  it('stores the object at the exact path (no UUID, no sanitize)', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: 'Design Docs/Q3 Handoff/doc.md' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/Design Docs/Q3 Handoff/doc.md');
    expect(parts.publicPath).toBe('/api/uploads/content/Design Docs/Q3 Handoff/doc.md');
    expect(parts.storedFilename).toBe('doc.md');
    expect(parts.sanitizedFilename).toBe('doc.md');
  });

  it('preserves spaces and unicode in every segment', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: 'Rapport Été/résumé final.md' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/Rapport Été/résumé final.md');
  });

  it('trims leading/trailing slashes before building', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ ...base, verbatimKey: '/assets/logo.png/' });
    expect(parts.storageKey).toBe('acme/site/uploads/content/assets/logo.png');
  });

  it('rejects an empty key', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '   ' })).toThrow(/empty/i);
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '///' })).toThrow(/empty/i);
  });

  it('rejects ".." traversal', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: '../secrets/x' })).toThrow(/traversal|\.\./i);
  });

  it('rejects an empty path segment ("//")', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: 'a//b.png' })).toThrow(/segment|\/\//i);
  });

  it('rejects control characters', () => {
    const svc = build();
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: 'a/\u0001b.png' })).toThrow(/control/i);
  });

  it('rejects a key that pushes the storage key past 1024 bytes', () => {
    const svc = build();
    const huge = 'a/'.repeat(700) + 'x.png'; // > 1024 bytes with the prefix
    expect(() => svc.buildUploadKey({ ...base, verbatimKey: huge })).toThrow(/1024|too long|length/i);
  });

  it('leaves UUID mode unchanged when verbatimKey is absent', () => {
    const svc = build();
    const parts = svc.buildUploadKey({ owner: 'acme', repo: 'site', subDir: 'content', originalName: 'a b.png' });
    // UUID prefix + sanitized filename, as today.
    expect(parts.storageKey).toMatch(
      /^acme\/site\/uploads\/content\/[0-9a-f-]{36}-a_b\.png$/,
    );
  });
});
