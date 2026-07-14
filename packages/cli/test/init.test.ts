import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { runInit } from '../src/commands/init.js';
import { SchemaManifestSchema } from '../src/format/manifest.js';
import { validateRuleSet } from '../src/commands/validate.js';

function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-init-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('runInit --schema — happy path', () => {
  it('writes schemas/<name>.schema.yaml with parsed fields and no id', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'comments', field: ['author:string:required', 'body:text'] }, dir);
    expect(result.ok).toBe(true);
    expect(result.outFile).toBe(path.join(dir, 'schemas', 'comments.schema.yaml'));
    expect(result.hint).toContain('$schema:comments');

    const raw = readFileSync(result.outFile!, 'utf8');
    const parsed = SchemaManifestSchema.parse(parseYaml(raw));
    expect(parsed).toEqual({
      name: 'comments',
      fields: [
        { name: 'author', type: 'string', required: true },
        { name: 'body', type: 'text', required: false },
      ],
    });
    expect(parsed.id).toBeUndefined();
    // The header must carry the two facts that make the flow self-explanatory.
    expect(raw).toContain('Synced by name');
    expect(raw).toContain('--strict-schemas');
  });

  it('accepts an explicit :optional modifier', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'items', field: ['note:text:optional'] }, dir);
    expect(result.ok).toBe(true);
    const parsed = SchemaManifestSchema.parse(parseYaml(readFileSync(result.outFile!, 'utf8')));
    expect(parsed.fields).toEqual([{ name: 'note', type: 'text', required: false }]);
  });

  it('with no --field, writes fields: [] plus a commented example', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'drafts' }, dir);
    expect(result.ok).toBe(true);
    const raw = readFileSync(result.outFile!, 'utf8');
    expect(SchemaManifestSchema.parse(parseYaml(raw)).fields).toEqual([]);
    expect(raw).toContain('# Example:');
  });

  it('produces a set that validateRuleSet accepts, including a $schema ref to the new schema', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/comments/post.rule.yaml': [
        'pipeline:',
        '  steps:',
        '    - name: save',
        '      handler: data_create',
        '      config:',
        '        schemaId: $schema:comments',
        '',
      ].join('\n'),
    });
    const result = runInit(dir, { schema: 'comments', field: ['author:string:required'] }, dir);
    expect(result.ok).toBe(true);
    const { errors } = await validateRuleSet(dir);
    expect(errors).toEqual([]);
  });
});

describe('runInit — directory resolution', () => {
  it('resolves the single ruleSets config match when no dir is given', () => {
    const root = scratchSet({
      '.bffless/config.json': JSON.stringify({ ruleSets: ['.bffless/proxy-rules/*'] }),
      '.bffless/proxy-rules/reader/ruleset.yaml': 'name: reader\n',
    });
    const result = runInit(undefined, { schema: 'feeds' }, root);
    expect(result.ok).toBe(true);
    expect(result.outFile).toBe(path.join(root, '.bffless', 'proxy-rules', 'reader', 'schemas', 'feeds.schema.yaml'));
  });

  it('errors when the config resolves multiple rule sets', () => {
    const root = scratchSet({
      '.bffless/config.json': JSON.stringify({ ruleSets: ['.bffless/proxy-rules/*'] }),
      '.bffless/proxy-rules/a/ruleset.yaml': 'name: a\n',
      '.bffless/proxy-rules/b/ruleset.yaml': 'name: b\n',
    });
    const result = runInit(undefined, { schema: 'feeds' }, root);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('2 rule sets resolved');
    expect(result.error).toContain('pass its directory explicitly');
  });

  it('errors on an explicit dir that is not a rule set', () => {
    const dir = scratchSet({ 'notes.txt': 'x\n' });
    const result = runInit(dir, { schema: 'feeds' }, dir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no ruleset.yaml');
  });
});

describe('runInit — guardrails', () => {
  it('requires --schema', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, {}, dir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--schema <name>');
  });

  it('rejects a path-unsafe schema name', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: '../evil' }, dir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid schema name');
  });

  it('rejects an unknown field type, a malformed spec, and a duplicate field name', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    expect(runInit(dir, { schema: 's1', field: ['a:uuid'] }, dir).error).toContain('unknown type "uuid"');
    expect(runInit(dir, { schema: 's2', field: ['justaname'] }, dir).error).toContain('expected <name>:<type>');
    expect(runInit(dir, { schema: 's3', field: ['a:string:maybe'] }, dir).error).toContain('"required" or "optional"');
    expect(runInit(dir, { schema: 's4', field: ['a:string', 'a:number'] }, dir).error).toContain(
      'duplicate field name "a"',
    );
  });

  it('refuses to overwrite an existing file without --force, overwrites with it', () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'schemas/comments.schema.yaml': 'name: comments\nfields: []\n',
    });
    const blocked = runInit(dir, { schema: 'comments' }, dir);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('already exists');
    expect(blocked.error).toContain('--force');

    const forced = runInit(dir, { schema: 'comments', field: ['author:string:required'], force: true }, dir);
    expect(forced.ok).toBe(true);
    expect(existsSync(forced.outFile!)).toBe(true);
    const parsed = SchemaManifestSchema.parse(parseYaml(readFileSync(forced.outFile!, 'utf8')));
    expect(parsed.fields).toHaveLength(1);
  });
});
