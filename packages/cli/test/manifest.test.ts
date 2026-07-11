import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RulesetManifestSchema,
  RuleManifestSchema,
  SchemaManifestSchema,
  FnTestManifestSchema,
  parseYamlFile,
} from '../src/format/manifest.js';
import { walkSchemaRefs, SCHEMA_REF_KEYS } from '../src/format/schema-refs.js';

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-manifest-test-'));
  const file = path.join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

describe('RulesetManifestSchema / parseYamlFile', () => {
  it('valid ruleset.yaml parses', () => {
    const file = tmpFile(
      'ruleset.yaml',
      ['name: my-ruleset', 'description: A test ruleset', 'environment: production', ''].join('\n'),
    );
    const parsed = parseYamlFile(file, RulesetManifestSchema);
    expect(parsed).toEqual({ name: 'my-ruleset', description: 'A test ruleset', environment: 'production' });
  });

  it('rejects an unknown top-level key, with the file path and key in the error message', () => {
    const file = tmpFile('ruleset.yaml', ['name: my-ruleset', 'bogus: true', ''].join('\n'));
    let thrown: Error | undefined;
    try {
      parseYamlFile(file, RulesetManifestSchema);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain(file);
    expect(thrown!.message).toContain('bogus');
  });
});

describe('RuleManifestSchema', () => {
  it('accepts `handler:` inside pipeline.steps[] (authoring form)', () => {
    const result = RuleManifestSchema.safeParse({
      pipeline: {
        steps: [{ name: 'step-1', handler: 'response_handler', config: {} }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects `handlerType:` inside pipeline.steps[] (canonical key doesn\'t belong in authoring form)', () => {
    const result = RuleManifestSchema.safeParse({
      pipeline: {
        steps: [{ name: 'step-1', handlerType: 'response_handler', config: {} }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects both `pipeline` and `pipelineConfig` present at once', () => {
    const result = RuleManifestSchema.safeParse({
      pipeline: { steps: [{ name: 's', handler: 'h', config: {} }] },
      pipelineConfig: { name: 'p', steps: [{ name: 's', handlerType: 'h', config: {} }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /may not both/i.test(i.message))).toBe(true);
    }
  });

  it('rejects a step with both `code` and `config.code`', () => {
    const result = RuleManifestSchema.safeParse({
      pipeline: {
        steps: [{ name: 's', handler: 'file_serve_handler', code: 'handlers/s.js', config: { code: 'inline' } }],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /code/i.test(i.message))).toBe(true);
    }
  });

  it('accepts a step with only `code` or only `config.code`, not both', () => {
    expect(
      RuleManifestSchema.safeParse({
        pipeline: { steps: [{ name: 's', handler: 'h', code: 'handlers/s.js' }] },
      }).success,
    ).toBe(true);
    expect(
      RuleManifestSchema.safeParse({
        pipeline: { steps: [{ name: 's', handler: 'h', config: { code: 'inline' } }] },
      }).success,
    ).toBe(true);
  });

  it('validates methods as the 7 uppercase HTTP verbs', () => {
    expect(RuleManifestSchema.safeParse({ methods: ['GET', 'POST'] }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ methods: ['get'] }).success).toBe(false);
    expect(RuleManifestSchema.safeParse({ methods: ['TRACE'] }).success).toBe(false);
  });

  it('validates timeout as an int in [1000, 120000]', () => {
    expect(RuleManifestSchema.safeParse({ timeout: 30000 }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ timeout: 999 }).success).toBe(false);
    expect(RuleManifestSchema.safeParse({ timeout: 120001 }).success).toBe(false);
    expect(RuleManifestSchema.safeParse({ timeout: 5000.5 }).success).toBe(false);
  });

  it('validates order as a non-negative int', () => {
    expect(RuleManifestSchema.safeParse({ order: 0 }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ order: 10 }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ order: -3 }).success).toBe(false);
    expect(RuleManifestSchema.safeParse({ order: 2.5 }).success).toBe(false);
  });

  it('validates pathPattern starts with "/" or "*"', () => {
    expect(RuleManifestSchema.safeParse({ pathPattern: '/api/x' }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ pathPattern: '*' }).success).toBe(true);
    expect(RuleManifestSchema.safeParse({ pathPattern: 'api/x' }).success).toBe(false);
  });

  it('rejects an unknown key with the offending path via parseYamlFile', () => {
    const file = tmpFile(
      'get.rule.yaml',
      ['pipeline:', '  steps:', '    - name: s', '      handler: h', '      bogus: true', ''].join('\n'),
    );
    let thrown: Error | undefined;
    try {
      parseYamlFile(file, RuleManifestSchema);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain(file);
    expect(thrown!.message).toContain('pipeline.steps[0]');
    expect(thrown!.message).toContain('bogus');
  });

  it('parseYamlFile error message contains file path and zod issue path for a missing required field', () => {
    const file = tmpFile(
      'get.rule.yaml',
      ['pipeline:', '  steps:', '    - name: s', '      config: {}', ''].join('\n'),
    );
    let thrown: Error | undefined;
    try {
      parseYamlFile(file, RuleManifestSchema);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain(file);
    expect(thrown!.message).toContain('pipeline.steps[0].handler — Required');
  });
});

describe('SchemaManifestSchema', () => {
  it('valid schema manifest parses, extra field-level metadata allowed', () => {
    const result = SchemaManifestSchema.safeParse({
      name: 'comments',
      fields: [{ name: 'body', type: 'string', required: true, maxLength: 500 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    const result = SchemaManifestSchema.safeParse({
      name: 'comments',
      fields: [],
      bogus: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    const result = SchemaManifestSchema.safeParse({ id: 'not-a-uuid', name: 'comments', fields: [] });
    expect(result.success).toBe(false);
  });
});

describe('FnTestManifestSchema', () => {
  it('happy path: handler + cases with expect.result', () => {
    const result = FnTestManifestSchema.safeParse({
      handler: 'handlers/greet.js',
      cases: [
        {
          name: 'greets by name',
          data: { request: { body: { name: 'Ada' } } },
          expect: { result: { greeting: 'Hello, Ada' } },
        },
        {
          name: 'throws on missing name',
          expect: { throws: 'name is required' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a case whose `expect` has neither `result` nor `throws`', () => {
    const result = FnTestManifestSchema.safeParse({
      handler: 'handlers/greet.js',
      cases: [{ name: 'empty expect', expect: {} }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /at least one/i.test(i.message))).toBe(true);
    }
  });
});

describe('walkSchemaRefs', () => {
  it('finds and replaces a schemaId nested three levels deep', () => {
    const doc = {
      rules: [
        {
          pipelineConfig: {
            steps: [{ name: 's', handlerType: 'data_query', config: { schemaId: 'old-id', limit: 10 } }],
          },
        },
      ],
    };
    // doc -> rules[0] -> pipelineConfig -> steps[0] -> config -> schemaId: three levels below `doc.rules[0]`.
    const seen: string[] = [];
    walkSchemaRefs(doc, (ref, set) => {
      seen.push(ref);
      set(`new-${ref}`);
    });
    expect(seen).toEqual(['old-id']);
    expect(doc.rules[0].pipelineConfig.steps[0].config.schemaId).toBe('new-old-id');
  });

  it('ignores a schemaId that is not a string', () => {
    const doc = { config: { schemaId: 42 } };
    const seen: unknown[] = [];
    walkSchemaRefs(doc, (ref) => seen.push(ref));
    expect(seen).toEqual([]);
    expect(doc.config.schemaId).toBe(42);
  });

  it('walks refs inside arrays, covering every SCHEMA_REF_KEYS variant', () => {
    const doc = {
      steps: [
        { config: { schemaId: 'a' } },
        { config: { persistMessagesSchemaId: 'b', persistConversationsSchemaId: 'c' } },
        { config: { conversationsSchemaId: 'd', messagesSchemaId: 'e' } },
      ],
    };
    const seen: string[] = [];
    walkSchemaRefs(doc, (ref, set) => {
      seen.push(ref);
      set(ref.toUpperCase());
    });
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(doc.steps[0].config.schemaId).toBe('A');
    expect(doc.steps[1].config.persistMessagesSchemaId).toBe('B');
    expect(doc.steps[1].config.persistConversationsSchemaId).toBe('C');
    expect(doc.steps[2].config.conversationsSchemaId).toBe('D');
    expect(doc.steps[2].config.messagesSchemaId).toBe('E');
  });

  it('SCHEMA_REF_KEYS has the five known schema-ref keys', () => {
    expect(SCHEMA_REF_KEYS).toEqual([
      'schemaId',
      'persistMessagesSchemaId',
      'persistConversationsSchemaId',
      'conversationsSchemaId',
      'messagesSchemaId',
    ]);
  });

  it('skips empty-string values under SCHEMA_REF_KEYS', () => {
    const doc = { config: { schemaId: '' } };
    const seen: string[] = [];
    walkSchemaRefs(doc, (ref) => seen.push(ref));
    expect(seen).toEqual([]);
    expect(doc.config.schemaId).toBe('');
  });
});
