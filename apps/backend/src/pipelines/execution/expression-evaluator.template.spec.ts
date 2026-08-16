import { ExpressionEvaluator } from './expression-evaluator';
import { PipelineContext } from './pipeline-context.interface';

/**
 * evaluateTemplate: substituted values must be terminal — data pulled in by
 * one placeholder is never re-scanned as template syntax (bffless/ce#431).
 */
describe('ExpressionEvaluator.evaluateTemplate', () => {
  const evaluator = new ExpressionEvaluator();

  const context = {
    user: { id: 'user-123' },
    stepOutputs: {
      gate: {
        node: { id: 'n1', name: '{{user.id}}' },
        name: '{{user.id}}',
        obj: { a: 1 },
        raw: 'raw{{{steps.gate.obj}}}',
      },
    },
  } as unknown as PipelineContext;

  it('substitutes {{expr}} with the string value', () => {
    expect(evaluator.evaluateTemplate('hello {{user.id}}!', context)).toBe('hello user-123!');
  });

  it('substitutes {{{expr}}} objects as JSON', () => {
    expect(evaluator.evaluateTemplate('{"node": {{{steps.gate.node}}}}', context)).toBe(
      '{"node": {"id":"n1","name":"{{user.id}}"}}',
    );
  });

  it('renders null/undefined as "null" for triple and "" for double braces', () => {
    expect(evaluator.evaluateTemplate('{{{steps.gate.missing}}}', context)).toBe('null');
    expect(evaluator.evaluateTemplate('[{{steps.gate.missing}}]', context)).toBe('[]');
  });

  it('does not re-evaluate {{ }} sequences contained in a {{{ }}} value', () => {
    // #431: the folder name is data, not template source
    const out = evaluator.evaluateTemplate('{"node": {{{steps.gate.node}}}}', context);
    expect(JSON.parse(out).node.name).toBe('{{user.id}}');
    expect(out).not.toContain('user-123');
  });

  it('does not re-evaluate {{ }} sequences contained in a {{ }} value', () => {
    expect(evaluator.evaluateTemplate('name={{steps.gate.name}}', context)).toBe(
      'name={{user.id}}',
    );
  });

  it('does not re-evaluate {{{ }}} sequences contained in a substituted value', () => {
    expect(evaluator.evaluateTemplate('{{steps.gate.raw}}', context)).toBe(
      'raw{{{steps.gate.obj}}}',
    );
    expect(evaluator.evaluateTemplate('{{{steps.gate.raw}}}', context)).toBe(
      'raw{{{steps.gate.obj}}}',
    );
  });

  it('handles mixed triple and double placeholders in one template', () => {
    expect(
      evaluator.evaluateTemplate('{"user":"{{user.id}}","obj":{{{steps.gate.obj}}}}', context),
    ).toBe('{"user":"user-123","obj":{"a":1}}');
  });

  it('leaves text without placeholders untouched', () => {
    expect(evaluator.evaluateTemplate('plain {text} } {{', context)).toBe('plain {text} } {{');
  });
});
