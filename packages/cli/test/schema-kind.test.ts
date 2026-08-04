import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { buildRuleSet } from '../src/compile/build.js';
import { runInit } from '../src/commands/init.js';
import { SchemaManifestSchema } from '../src/format/manifest.js';
import { decompileExport } from '../src/compile/decompile.js';
import { canonicalizeExport } from '../src/format/canonical.js';
import type { RuleSetExport } from '../src/format/types.js';

function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-schema-kind-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

const RULE = 'pipeline:\n  steps:\n    - name: q\n      handler: data_query\n      config:\n        schemaId: $schema:widgets\n';

/** A rule set whose one schema declares (or omits) a kind. */
const set = (kindLine: string) =>
  scratchSet({
    'ruleset.yaml': 'name: s\n',
    'rules/api/x/get.rule.yaml': RULE,
    'schemas/widgets.schema.yaml': `name: widgets\n${kindLine}fields:\n  - name: id\n    type: string\n`,
  });

describe('schema kind in the authoring format (ce#633)', () => {
  it('carries a declared kind into the compiled export', async () => {
    const { export: out } = await buildRuleSet(set('kind: upload\n'));
    expect(out.schemas?.[0].kind).toBe('upload');
  });

  it('omits the key entirely when the yaml declares no kind', async () => {
    const { export: out } = await buildRuleSet(set(''));
    expect(out.schemas?.[0]).not.toHaveProperty('kind');
  });

  it('rejects a kind the server would not accept', async () => {
    // The manifest schema is strict, so a typo must fail the build rather than
    // reaching the server as an unknown value.
    await expect(buildRuleSet(set('kind: uploads\n'))).rejects.toThrow(/kind/);
  });

  it('emits kind between name and fields, matching the server export builder', async () => {
    // Schema entries have no fixed key order — the canonicalizer copies them —
    // so a divergence here silently breaks byte-identical exports.
    const { export: out } = await buildRuleSet(set('kind: upload\n'));
    expect(Object.keys(out.schemas![0])).toEqual(['id', 'name', 'kind', 'fields']);
  });

  it('survives canonicalization unchanged', async () => {
    const { export: out } = await buildRuleSet(set('kind: state\n'));
    expect(canonicalizeExport(out).schemas?.[0].kind).toBe('state');
  });

  it('round-trips through decompile back into the schema yaml', async () => {
    const { export: out } = await buildRuleSet(set('kind: chat\n'));
    const { files } = decompileExport(out as RuleSetExport);
    const yaml = files.get('schemas/widgets.schema.yaml')!;
    expect(yaml).toMatch(/kind: chat/);

    // ...and recompiles to the same export, which is the decompiler's contract.
    const dir = scratchSet(Object.fromEntries(files));
    const { export: rebuilt } = await buildRuleSet(dir);
    expect(rebuilt.schemas).toEqual(out.schemas);
  });

  it('leaves the yaml without a kind key when the export has none', async () => {
    const { export: out } = await buildRuleSet(set(''));
    const { files } = decompileExport(out as RuleSetExport);
    expect(files.get('schemas/widgets.schema.yaml')).not.toMatch(/kind:/);
  });
});

describe('rules init --kind', () => {
  it('scaffolds a schema that declares its kind', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'avatars', kind: 'upload', field: ['url:string'] }, dir);
    expect(result.ok).toBe(true);

    const raw = readFileSync(result.outFile!, 'utf8');
    // Parses under the strict manifest schema, so what init writes is what the
    // compiler accepts.
    expect(SchemaManifestSchema.parse(parseYaml(raw)).kind).toBe('upload');
    expect(raw).toContain('declares what the schema is FOR');
  });

  it('omits the key when no kind is asked for', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'notes', field: ['body:text'] }, dir);
    expect(readFileSync(result.outFile!, 'utf8')).not.toMatch(/^kind:/m);
  });

  it('rejects an unknown kind instead of writing a file the server will refuse', () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const result = runInit(dir, { schema: 'avatars', kind: 'uploads' }, dir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid --kind "uploads"');
  });
});
