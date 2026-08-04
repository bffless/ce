jest.mock('../db/client', () => {
  const queued: unknown[] = [];
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'offset'];
  const chainable: Record<string, unknown> = {};
  for (const method of methods) chainable[method] = jest.fn(() => chainable);
  chainable.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve(queued.length > 0 ? queued.shift() : []).then(resolve, reject);
  chainable.__queue = (result: unknown) => queued.push(result);
  chainable.__reset = () => {
    queued.length = 0;
    for (const method of methods) (chainable[method] as jest.Mock).mockClear();
  };
  return { db: chainable };
});

import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { PipelineDataService } from './pipeline-data.service';
import { PermissionsService } from '../permissions/permissions.service';

const mockDb = db as unknown as Record<string, jest.Mock> & {
  __queue: (r: unknown) => void;
  __reset: () => void;
};

/**
 * The admin data listing supports JSONB field filters. `exists` is the one op
 * that asks about presence rather than value — it is what the Uploads tab uses
 * to show only records that actually reference a stored file, in schemas that
 * mix file rows with non-file rows (e.g. a folder tree stored in one schema).
 */
describe('PipelineDataService field filters', () => {
  const service = new PipelineDataService({
    requireProjectAccess: jest.fn(),
  } as unknown as PermissionsService);

  beforeEach(() => mockDb.__reset());

  /** Run a filtered list and return the rendered SQL of the count query's WHERE. */
  async function whereSqlFor(
    filters: Record<string, { op: string; value: string }>,
  ): Promise<string> {
    mockDb.__queue([{ id: 'schema-1', projectId: 'proj-1', fields: [] }]); // schema lookup
    mockDb.__queue([{ count: 0 }]); // count query
    mockDb.__queue([]); // records query
    await service.getBySchemaId('schema-1', 1, 20, 'user-1', 'user', { filters }, null);
    // call 0 is the schema lookup; call 1 is the filtered count query
    return new PgDialect().sqlToQuery(mockDb.where.mock.calls[1][0]).sql.toLowerCase();
  }

  it('exists: keeps only rows where the field is present', async () => {
    const sql = await whereSqlFor({ storage_path: { op: 'exists', value: 'true' } });
    expect(sql).toContain("->>'storage_path' is not null");
  });

  it('exists with value "false": keeps only rows missing the field', async () => {
    const sql = await whereSqlFor({ storage_path: { op: 'exists', value: 'false' } });
    expect(sql).toContain("->>'storage_path' is null");
    expect(sql).not.toContain('is not null');
  });

  it('leaves unknown ops out of the query rather than failing the request', async () => {
    const sql = await whereSqlFor({ storage_path: { op: 'wat', value: 'x' } });
    expect(sql).not.toContain('storage_path');
  });
});
