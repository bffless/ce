/**
 * `rules init` — scaffold authoring files in a rule-set directory.
 *
 * Currently only `--schema <name>`: generates `schemas/<name>.schema.yaml`. Schemas are
 * synced BY NAME on `rules push` (created in the project when missing, reused when a
 * same-name schema exists), so no pre-created server id is ever needed — the generated
 * manifest deliberately has no `id`. The one sharp edge worth scaffolding around: push
 * never changes the fields of an existing live schema (the live definition wins; a
 * mismatch warns, or fails under `--strict-schemas`), so the generated header comment
 * tells the author to settle fields before the first push.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { resolveRuleSetDirs } from '../config.js';

export interface InitOptions {
  schema?: string;
  field?: string[];
  force?: boolean;
}

export interface InitOutcome {
  ok: boolean;
  outFile?: string;
  hint?: string;
  error?: string;
}

/** Field types accepted by pipeline schemas (mirrors the backend's `SchemaFieldType`). */
export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'email', 'text', 'datetime', 'json'] as const;

/** Schema names become filenames (`schemas/<name>.schema.yaml`), so keep them path-safe. */
const SCHEMA_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

interface ParsedField {
  name: string;
  type: string;
  required: boolean;
}

/** Parse a `--field <name>:<type>[:required|optional]` spec; returns an error string on failure. */
function parseFieldSpec(spec: string): ParsedField | string {
  const parts = spec.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return `--field "${spec}": expected <name>:<type> or <name>:<type>:required`;
  }
  const [name, type, flag] = parts;
  if (!FIELD_NAME_RE.test(name)) {
    return `--field "${spec}": invalid field name "${name}"`;
  }
  if (!(SCHEMA_FIELD_TYPES as readonly string[]).includes(type)) {
    return `--field "${spec}": unknown type "${type}" (expected ${SCHEMA_FIELD_TYPES.join(' | ')})`;
  }
  if (flag !== undefined && flag !== 'required' && flag !== 'optional') {
    return `--field "${spec}": trailing modifier must be "required" or "optional"`;
  }
  return { name, type, required: flag === 'required' };
}

function schemaYaml(name: string, fields: ParsedField[]): string {
  const header = [
    `# Pipeline schema "${name}" — reference it from rules as \`$schema:${name}\`.`,
    '#',
    '# Synced by name on `rules push`: created in the project when missing, reused when a',
    '# schema with this name already exists — no id needed, the name is the identity.',
    '# NOTE: push never changes the fields of an existing live schema (the live definition',
    '# wins; a mismatch warns, or fails under --strict-schemas). Settle fields before the',
    '# first push; edit live fields in the dashboard.',
    '#',
    `# Field types: ${SCHEMA_FIELD_TYPES.join(' | ')}`,
  ].join('\n');
  const body = stringifyYaml({ name, fields }, { blockQuote: 'literal', lineWidth: 0 });
  const example =
    fields.length > 0
      ? ''
      : [
          '# Example:',
          '# fields:',
          '#   - name: title',
          '#     type: string',
          '#     required: true',
          '#   - name: body',
          '#     type: text',
          '#     required: false',
          '',
        ].join('\n');
  return `${header}\n${body}${example}`;
}

export function runInit(dir: string | undefined, opts: InitOptions, cwd: string): InitOutcome {
  if (!opts.schema) {
    return { ok: false, error: 'rules init currently only scaffolds schemas — pass --schema <name>' };
  }
  const name = opts.schema;
  if (name.length > 100 || !SCHEMA_NAME_RE.test(name)) {
    return {
      ok: false,
      error: `invalid schema name "${name}" — letters, digits, ".", "_", "-" only (must start with a letter or digit)`,
    };
  }

  const fields: ParsedField[] = [];
  for (const spec of opts.field ?? []) {
    const parsed = parseFieldSpec(spec);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    fields.push(parsed);
  }
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) return { ok: false, error: `duplicate field name "${f.name}"` };
    seen.add(f.name);
  }

  let setDir: string;
  try {
    const resolved = resolveRuleSetDirs(cwd, dir ? [dir] : []);
    if (resolved.length !== 1) {
      const listed = resolved.map((d) => path.relative(cwd, d) || '.').join(', ');
      return {
        ok: false,
        error:
          `${resolved.length} rule sets resolved${listed ? ` (${listed})` : ''} — ` +
          'a schema belongs to one set; pass its directory explicitly',
      };
    }
    setDir = resolved[0];
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const outFile = path.join(setDir, 'schemas', `${name}.schema.yaml`);
  if (existsSync(outFile) && !opts.force) {
    return { ok: false, error: `${path.relative(cwd, outFile)} already exists (use --force to overwrite)` };
  }
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, schemaYaml(name, fields), 'utf8');
  return { ok: true, outFile, hint: `reference it from a rule pipeline as $schema:${name}` };
}
