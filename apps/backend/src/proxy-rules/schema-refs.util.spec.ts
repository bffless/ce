import { collectSchemaIds, remapSchemaIds } from './schema-refs.util';

describe('schema-refs.util', () => {
  // A rule shaped like an exported pipeline rule, exercising steps, postSteps,
  // and the ai handler's non-`schemaId` reference keys.
  const rules = [
    {
      pathPattern: '/api/*',
      proxyType: 'pipeline',
      pipelineConfig: {
        name: 'p',
        steps: [
          { name: 'q', handlerType: 'data_query', config: { schemaId: 'A', pageSize: 10 } },
          { name: 'u', handlerType: 'file_upload', config: { schemaId: 'B', subDir: 'x' } },
          {
            name: 'chat',
            handlerType: 'ai',
            config: { persistMessagesSchemaId: 'C', persistConversationsSchemaId: 'A' },
          },
        ],
        postSteps: [
          { name: 'c', handlerType: 'data_create', config: { schemaId: 'A', fields: {} } },
        ],
      },
    },
    {
      pathPattern: '/static',
      proxyType: 'external_proxy',
      targetUrl: 'https://example.com',
      pipelineConfig: null,
    },
  ];

  describe('collectSchemaIds', () => {
    it('collects distinct ids across steps, postSteps, and ai handler keys', () => {
      expect(collectSchemaIds(rules)).toEqual(new Set(['A', 'B', 'C']));
    });

    it('ignores empty/non-string values and non-pipeline rules', () => {
      expect(collectSchemaIds([{ pipelineConfig: null }, { config: { schemaId: '' } }])).toEqual(
        new Set(),
      );
    });
  });

  describe('remapSchemaIds', () => {
    it('rewrites mapped ids in every schema-ref key and leaves the rest untouched', () => {
      const idMap = new Map([
        ['A', 'A2'],
        ['B', 'B2'],
        ['C', 'C2'],
      ]);
      const out = remapSchemaIds(rules, idMap);

      const cfg = out[0].pipelineConfig!;
      expect(cfg.steps[0].config.schemaId).toBe('A2');
      expect(cfg.steps[0].config.pageSize).toBe(10); // non-ref field preserved
      expect(cfg.steps[1].config.schemaId).toBe('B2');
      expect(cfg.steps[2].config.persistMessagesSchemaId).toBe('C2');
      expect(cfg.steps[2].config.persistConversationsSchemaId).toBe('A2');
      expect(cfg.postSteps[0].config.schemaId).toBe('A2');
      expect(out[1].targetUrl).toBe('https://example.com'); // untouched rule
    });

    it('leaves ids absent from the map unchanged (e.g. unbundled refs)', () => {
      const out = remapSchemaIds(rules, new Map([['A', 'A2']]));
      const cfg = out[0].pipelineConfig!;
      expect(cfg.steps[0].config.schemaId).toBe('A2');
      expect(cfg.steps[1].config.schemaId).toBe('B'); // not in map → unchanged
    });

    it('does not mutate the input', () => {
      const out = remapSchemaIds(rules, new Map([['A', 'A2']]));
      expect(rules[0].pipelineConfig!.steps[0].config.schemaId).toBe('A');
      expect(out).not.toBe(rules);
    });
  });
});
