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
