import { describe, it, expect } from 'vitest';
import workflow from './__fixtures__/workflow.json';
import {
  normalize,
  serialize,
  validate,
  matchesPattern,
  findSibling,
  emptyTool,
  type McpConfig,
} from './model';

describe('normalize + serialize', () => {
  it('keeps every tool, resource, annotation, _meta and csp entry of the shipped workflow config', () => {
    const model = normalize(workflow as Record<string, unknown>);
    expect(model.tools).toHaveLength(15);
    expect(serialize(model)).toEqual(workflow);
  });

  it('normalizes an empty config into a form-ready model', () => {
    const model = normalize({});
    expect(model.serverInfo).toEqual({ name: '', version: '' });
    expect(model.tools).toEqual([]);
    expect(model.resources).toEqual({
      static: [],
      templates: [],
      csp: { connectDomains: [], resourceDomains: [] },
    });
    expect(model.instructions).toBe('');
    expect(model.protocolVersions).toEqual([]);
  });

  it('omits empty optionals and the default visibility on write', () => {
    const model = normalize({
      serverInfo: { name: 'x', version: '1' },
      tools: [
        {
          name: 't',
          description: '',
          inputSchema: { type: 'object' },
          rule: { path: '/a', method: 'POST' },
          annotations: {},
          visibility: ['model'],
          _meta: { ui: {} },
        },
      ],
    });
    expect(serialize(model)).toEqual({
      serverInfo: { name: 'x', version: '1' },
      tools: [
        {
          name: 't',
          description: '',
          inputSchema: { type: 'object' },
          rule: { path: '/a', method: 'POST' },
        },
      ],
    });
  });

  it('carries unknown keys through on the config, a tool and a resource', () => {
    const raw = {
      serverInfo: { name: 'x', version: '1' },
      future: { flag: true },
      tools: [
        {
          name: 't',
          description: 'd',
          inputSchema: { type: 'object' },
          rule: { path: '/a' },
          title: 'Tool T',
          _meta: { ui: { resourceUri: 'ui://x' }, vendor: 1 },
          annotations: { readOnlyHint: true, custom: 'y' },
        },
      ],
      resources: { static: [{ uri: 'ui://x', name: 'X', rule: { path: '/x' }, extra: 2 }] },
    };
    expect(serialize(normalize(raw))).toEqual(raw);
  });

  it('emptyTool is a POST tool with an empty closed object schema', () => {
    expect(emptyTool()).toEqual({
      name: '',
      description: '',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: {},
      visibility: [],
      _meta: {},
      rule: { path: '', method: 'POST' },
    });
  });
});

describe('validate', () => {
  const base = (): McpConfig => normalize({ serverInfo: { name: 's', version: '1' }, tools: [] });

  it('accepts the shipped workflow config', () => {
    expect(validate(normalize(workflow as Record<string, unknown>))).toEqual([]);
  });

  it('requires serverInfo name and version', () => {
    const problems = validate(normalize({}));
    expect(problems).toContainEqual({
      path: ['serverInfo'],
      message: 'serverInfo.name and serverInfo.version are required strings',
    });
  });

  it('names each tool problem by its index', () => {
    const c = base();
    c.tools.push(
      { ...emptyTool(), name: 'a', rule: { path: 'nope', method: 'POST' } },
      { ...emptyTool(), name: 'a', rule: { path: '/ok', method: 'POST' } },
      { ...emptyTool(), name: '', rule: { path: '/ok', method: 'POST' } },
    );
    const problems = validate(c);
    expect(problems).toContainEqual({
      path: ['tools', 0, 'rule', 'path'],
      message: 'tool a: rule.path must start with /',
    });
    expect(problems).toContainEqual({
      path: ['tools', 1, 'name'],
      message: 'duplicate tool name: a',
    });
    expect(problems).toContainEqual({
      path: ['tools', 2, 'name'],
      message: 'each tool needs a name',
    });
  });

  it('checks a template declares a variable and a list rule has a path', () => {
    const c = base();
    c.resources.templates.push({ uriTemplate: 'ui://plain', name: 'p', rule: { path: '/p' } });
    c.resources.list = { rule: { path: '' } };
    const problems = validate(c);
    expect(problems).toContainEqual({
      path: ['resources', 'templates', 0, 'uriTemplate'],
      message: 'resource template ui://plain declares no {variable}',
    });
    expect(problems).toContainEqual({
      path: ['resources', 'list', 'rule', 'path'],
      message: 'resources.list.rule.path is required',
    });
  });

  it('checks a static resource has uri, name and rule.path', () => {
    const c = base();
    c.resources.static.push({ uri: '', name: 'x', rule: { path: '/x' } });
    expect(validate(c)).toContainEqual({
      path: ['resources', 'static', 0],
      message: 'each static resource needs uri, name and rule.path',
    });
  });
});

describe('matchesPattern + findSibling', () => {
  it('matches exactly or by * glob like the backend resolver', () => {
    expect(matchesPattern('/api/a', '/api/a')).toBe(true);
    expect(matchesPattern('/api/*', '/api/a/b')).toBe(true);
    expect(matchesPattern('/api/*', '/api')).toBe(false);
    expect(matchesPattern('/w/*', '/w/{impl}/{path+}')).toBe(true);
  });

  it('finds the first enabled sibling whose pattern and method match', () => {
    const rules = [
      { id: '1', pathPattern: '/api/x', method: 'GET', methods: null, isEnabled: true },
      { id: '2', pathPattern: '/api/x', method: null, methods: ['POST'], isEnabled: true },
      { id: '3', pathPattern: '/api/*', method: null, methods: null, isEnabled: false },
      { id: '4', pathPattern: '/api/*', method: null, methods: null, isEnabled: true },
    ];
    expect(findSibling(rules, '/api/x', 'POST')?.id).toBe('2');
    expect(findSibling(rules, '/api/x', 'GET')?.id).toBe('1');
    expect(findSibling(rules, '/api/y', 'GET')?.id).toBe('4');
    expect(findSibling(rules, '/other', 'GET')).toBeUndefined();
  });
});
