import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { pipelineData } from '../../db/schema';
import { buildInPredicate } from './in-filter.util';

function render(pred: ReturnType<typeof buildInPredicate>) {
  return new PgDialect().sqlToQuery(pred);
}

const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'feedId'`)}`;

describe('buildInPredicate', () => {
  it('emits a parameterized IN list for a non-empty array', () => {
    const { sql: text, params } = render(buildInPredicate(fieldPath, ['a', 'b']));
    expect(text).toContain('in (');
    expect(params).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('binds every element as text', () => {
    const { params } = render(buildInPredicate(fieldPath, [1, 2]));
    expect(params).toEqual(expect.arrayContaining(['1', '2']));
  });

  it('wraps a non-array scalar into a single-element list', () => {
    const { params } = render(buildInPredicate(fieldPath, 'solo'));
    expect(params).toContain('solo');
  });

  it('compiles an empty array to a match-nothing predicate', () => {
    const { sql: text } = render(buildInPredicate(fieldPath, []));
    expect(text.toLowerCase()).toContain('false');
  });

  it('treats null/undefined as empty (match nothing)', () => {
    expect(render(buildInPredicate(fieldPath, null)).sql.toLowerCase()).toContain('false');
    expect(render(buildInPredicate(fieldPath, undefined)).sql.toLowerCase()).toContain('false');
  });
});
