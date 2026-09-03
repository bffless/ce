import { expandPath, listedTools, matchTemplate, uiMeta } from './resources';

describe('resources', () => {
  it('matches level-1 templates: {var} one segment, {var+} a tail', () => {
    expect(
      matchTemplate('ui://bffless/{impl}/{path+}', 'ui://bffless/hello/islands/pick-line.html'),
    ).toEqual({
      impl: 'hello',
      path: 'islands/pick-line.html',
    });
    expect(matchTemplate('ui://bffless/{impl}/{path+}', 'ui://other/hello/x.html')).toBeNull();
    expect(matchTemplate('ui://bffless/{impl}/x.html', 'ui://bffless/a/b/x.html')).toBeNull();
    expect(matchTemplate('ui://bffless/{impl}/{path+}', 'ui://bffless/hello/../secret')).toBeNull();
    expect(matchTemplate('ui://bffless/{impl}/{path+}', 'ui://bffless/hello/a//b')).toBeNull();
  });
  it('expands the sibling path, encoding segments', () => {
    expect(expandPath('/w/{impl}/{path+}', { impl: 'hello', path: 'islands/pick line.html' })).toBe(
      '/w/hello/islands/pick%20line.html',
    );
    expect(expandPath('/w/{impl}/x', { impl: 'a/b' })).toBe('/w/a%2Fb/x');
  });
  it('generates _meta.ui from the csp tokens and drops empty origins', () => {
    expect(
      uiMeta(
        { connectDomains: ['$app', '$storage'], resourceDomains: ['$storage'] },
        { app: 'https://h', storage: '' },
      ),
    ).toEqual({
      ui: { csp: { connectDomains: ['https://h'], resourceDomains: [] }, prefersBorder: true },
    });
    expect(uiMeta(undefined, { app: 'https://h', storage: 'https://s' }).ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
    });
    expect(
      uiMeta(
        { connectDomains: ['https://cdn.example', '$storage'] },
        { app: 'https://h', storage: 'https://s' },
      ).ui.csp.connectDomains,
    ).toEqual(['https://cdn.example', 'https://s']);
  });
  it('lists tools without their rule mapping, mapping app visibility into _meta.ui', () => {
    const listed = listedTools([
      {
        name: 'a',
        description: 'd',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
        rule: { path: '/x' },
      },
      {
        name: 'b',
        description: 'd',
        inputSchema: { type: 'object' },
        visibility: ['app'],
        _meta: { ui: { resourceUri: 'ui://x' } },
        rule: { path: '/y' },
      },
    ]);
    expect(listed[0]).toEqual({
      name: 'a',
      description: 'd',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    });
    expect(listed[1]).toEqual({
      name: 'b',
      description: 'd',
      inputSchema: { type: 'object' },
      _meta: { ui: { resourceUri: 'ui://x', visibility: ['app'] } },
    });
    expect(JSON.stringify(listed)).not.toContain('rule');
  });
});
