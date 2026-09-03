import { getTableConfig } from 'drizzle-orm/pg-core';
import { appTokens } from './app-tokens.schema';

/**
 * `deleteProject()` and `UsersService.delete()` enumerate the tables they clean
 * up by hand; a new `project_id` / `user_id` FK left at NO ACTION fails the
 * delete mid-way (ce#730 review). App tokens cascade instead — a token has no
 * meaning without its project or its member — and this pins that.
 */
describe('app_tokens foreign keys', () => {
  it('cascade on project and user deletion', () => {
    const { foreignKeys } = getTableConfig(appTokens);
    const byColumn = new Map(
      foreignKeys.map((fk) => {
        const ref = fk.reference();
        return [ref.columns[0].name, { table: ref.foreignTable, onDelete: fk.onDelete }];
      }),
    );
    expect(byColumn.get('project_id')?.onDelete).toBe('cascade');
    expect(byColumn.get('user_id')?.onDelete).toBe('cascade');
  });
});
