import { getTableConfig } from 'drizzle-orm/pg-core';
import { oauthAuthorizationCodes } from './oauth-authorization-codes.schema';
import { oauthRefreshTokens } from './oauth-refresh-tokens.schema';

/** Same rule as app_tokens (ce#730 review): no NO ACTION FK to projects/users/clients. */
function onDeleteOf(
  table: Parameters<typeof getTableConfig>[0],
): Record<string, string | undefined> {
  return Object.fromEntries(
    getTableConfig(table).foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns[0].name, fk.onDelete];
    }),
  );
}

describe('OAuth tables cascade with what they reference', () => {
  it('authorization codes', () => {
    expect(onDeleteOf(oauthAuthorizationCodes)).toEqual({
      client_id: 'cascade',
      user_id: 'cascade',
      project_id: 'cascade',
    });
  });
  it('refresh tokens (the issued access token may go first: set null)', () => {
    expect(onDeleteOf(oauthRefreshTokens)).toEqual({
      client_id: 'cascade',
      user_id: 'cascade',
      project_id: 'cascade',
      app_token_id: 'set null',
    });
  });
});
