import { mergeRuleThreeWay } from './three-way-merge.util';
import type { NormalizedSyncRule } from './sync-plan.util';

/**
 * Rule-level granularity manufactures conflicts that aren't real: an app
 * changing a step's `systemPrompt` and a user repointing that same step's
 * `skills` are edits to different fields. Merging per field resolves those
 * automatically, so only a genuine same-field disagreement ever needs a human.
 */
const ruleBase = (pipelineConfig: unknown = null): NormalizedSyncRule =>
  ({
    pathPattern: '/api/thumbnail/draft',
    method: 'POST',
    methods: null,
    targetUrl: '',
    stripPrefix: true,
    order: 50,
    timeout: 120000,
    preserveHost: false,
    forwardCookies: false,
    headerConfig: null,
    authTransform: null,
    internalRewrite: false,
    proxyType: 'pipeline',
    emailHandlerConfig: null,
    pipelineConfig,
    isEnabled: true,
    debugEnabled: false,
    description: null,
  }) as NormalizedSyncRule;

/** A one-step pipeline whose `draft` step config is the interesting part. */
const pipeline = (draftConfig: Record<string, unknown>) => ({
  name: 'thumbnail-draft',
  steps: [
    { id: 'prep', handler: 'function_handler', config: { code: './prep.fn.js' } },
    { id: 'draft', handler: 'ai_handler', config: draftConfig },
  ],
});

const SKILLS_APP = { mode: 'selected', enabled: ['image-prompts'] };
const SKILLS_USER = { mode: 'selected', enabled: ['thumbnail-concepts'], alias: 'skills', path: './' };

describe('mergeRuleThreeWay', () => {
  it('keeps both sides when they changed different step config keys', () => {
    const base = ruleBase(pipeline({ systemPrompt: 'old prompt', skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ systemPrompt: 'old prompt', skills: SKILLS_USER }));
    const theirs = ruleBase(pipeline({ systemPrompt: 'NEW prompt', skills: SKILLS_APP }));

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    expect(conflicts).toEqual([]);
    const draft = (merged.pipelineConfig as any).steps[1].config;
    expect(draft.systemPrompt).toBe('NEW prompt'); // app's improvement lands
    expect(draft.skills).toEqual(SKILLS_USER); // user's customization survives
  });

  it('reports a genuine same-field conflict and honours preserve', () => {
    const base = ruleBase(pipeline({ skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ skills: SKILLS_USER }));
    const theirs = ruleBase(
      pipeline({ skills: { mode: 'selected', enabled: ['image-prompts', 'bffless-docs'] } }),
    );

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    // Only `enabled` genuinely conflicts: the payload has no `alias`/`path` at
    // all, so those user additions are an only-ours change and survive.
    expect(conflicts.map((c) => c.field)).toEqual([
      'pipelineConfig.steps.draft.config.skills.enabled',
    ]);
    expect((merged.pipelineConfig as any).steps[1].config.skills).toEqual(SKILLS_USER);
  });

  it('takes the payload for the same conflict under overwrite', () => {
    const base = ruleBase(pipeline({ skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ skills: SKILLS_USER }));
    const theirsSkills = { mode: 'selected', enabled: ['image-prompts', 'bffless-docs'] };
    const theirs = ruleBase(pipeline({ skills: theirsSkills }));

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'overwrite');

    expect(conflicts.map((c) => c.field)).toEqual([
      'pipelineConfig.steps.draft.config.skills.enabled',
    ]);
    // The payload wins the contested key; `alias`/`path` are untouched by it,
    // so they survive even under overwrite.
    expect((merged.pipelineConfig as any).steps[1].config.skills).toEqual({
      ...theirsSkills,
      alias: 'skills',
      path: './',
    });
  });

  it('merges independent top-level fields', () => {
    const base = ruleBase();
    const ours = ruleBase();
    ours.description = 'my note';
    const theirs = ruleBase();
    theirs.timeout = 60000;

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    expect(conflicts).toEqual([]);
    expect(merged.description).toBe('my note');
    expect(merged.timeout).toBe(60000);
  });

  it('refuses to guess when the step id sets differ, conflicting the whole pipeline', () => {
    // Adding or removing a step is structural — merging it by position or id
    // could reorder a pipeline into something neither side asked for.
    const base = ruleBase(pipeline({ skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ skills: SKILLS_USER }));
    const theirs = ruleBase({
      name: 'thumbnail-draft',
      steps: [
        { id: 'prep', handler: 'function_handler', config: { code: './prep.fn.js' } },
        { id: 'draft', handler: 'ai_handler', config: { skills: SKILLS_APP } },
        { id: 'audit', handler: 'function_handler', config: {} },
      ],
    });

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    expect(conflicts.map((c) => c.field)).toEqual(['pipelineConfig.steps']);
    expect((merged.pipelineConfig as any).steps).toHaveLength(2); // preserve keeps ours
  });

  it('takes the payload wholesale when the user changed nothing', () => {
    const base = ruleBase(pipeline({ systemPrompt: 'old', skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ systemPrompt: 'old', skills: SKILLS_APP }));
    const theirs = ruleBase(pipeline({ systemPrompt: 'new', skills: SKILLS_APP }));

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    expect(conflicts).toEqual([]);
    expect((merged.pipelineConfig as any).steps[1].config.systemPrompt).toBe('new');
  });

  it('keeps a key the user added that the payload never had', () => {
    const base = ruleBase(pipeline({ skills: SKILLS_APP }));
    const ours = ruleBase(pipeline({ skills: SKILLS_APP, temperature: 0.4 }));
    const theirs = ruleBase(pipeline({ skills: SKILLS_APP }));

    const { merged, conflicts } = mergeRuleThreeWay(base, ours, theirs, 'preserve');

    expect(conflicts).toEqual([]);
    expect((merged.pipelineConfig as any).steps[1].config.temperature).toBe(0.4);
  });
});
