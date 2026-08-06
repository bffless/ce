import { describe, it, expect } from 'vitest';
import { applyConflictField } from './applyConflictField';

/**
 * Conflict paths address pipeline steps by their `id`, not their index (that's
 * how the server merges them), so applying a value has to resolve that segment
 * the same way — an index-based walk would write into the wrong step whenever
 * the app reorders its pipeline.
 */
type Step = { id: string; config: Record<string, unknown> };
type Rule = { id: string; timeout: number; pipelineConfig: { name: string; steps: Step[] } };

const rule = (): Rule => ({
  id: 'rule-1',
  timeout: 30000,
  pipelineConfig: {
    name: 'thumbnail-draft',
    steps: [
      { id: 'prep', config: { code: './prep.fn.js' } },
      { id: 'draft', config: { skills: { mode: 'selected', enabled: ['mine'] } } },
    ],
  },
});

/** Read a step's config as a loose bag — the fixture's two steps deliberately
 *  have different config shapes. */
const cfg = (r: Rule, i: number) =>
  r.pipelineConfig.steps[i]!.config as Record<string, { [k: string]: unknown } & string[]>;

describe('applyConflictField', () => {
  it('writes into the step named by id, not by position', () => {
    const out = applyConflictField(
      rule(),
      'pipelineConfig.steps.draft.config.skills.enabled',
      ['image-prompts'],
    );

    expect(cfg(out, 1).skills.enabled).toEqual(['image-prompts']);
    // Untouched siblings survive.
    expect(cfg(out, 0).code).toBe('./prep.fn.js');
    expect(cfg(out, 1).skills.mode).toBe('selected');
  });

  it('sets a top-level field', () => {
    const out = applyConflictField(rule(), 'timeout', 60000);
    expect(out.timeout).toBe(60000);
  });

  it('replaces a whole step when the path stops there', () => {
    const out = applyConflictField(rule(), 'pipelineConfig.steps', [
      { id: 'only', config: {} },
    ]);
    expect(out.pipelineConfig.steps).toEqual([{ id: 'only', config: {} }]);
  });

  it('does not mutate the input', () => {
    const original = rule();
    applyConflictField(original, 'timeout', 999);
    expect(original.timeout).toBe(30000);
  });

  it('returns the rule untouched when the path does not resolve', () => {
    const original = rule();
    const out = applyConflictField(original, 'pipelineConfig.steps.missing.config.x', 1);
    expect(out).toEqual(original);
  });
});
