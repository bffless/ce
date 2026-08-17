import { IdTokenMinter, NoAuth } from './id-token';

it('NoAuth sends no headers', async () => {
  expect(await new NoAuth().headers('https://w')).toEqual({});
});

it('mints an ID token for the URL origin, creating one client per audience and reusing it', async () => {
  const getRequestHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer tok' });
  const getIdTokenClient = jest.fn().mockResolvedValue({ getRequestHeaders });
  const factory = jest.fn().mockReturnValue({ getIdTokenClient });
  const minter = new IdTokenMinter('{"type":"service_account"}', factory);
  await minter.headers('https://w.run.app/jobs');
  await minter.headers('https://w.run.app/healthz');
  expect(factory).toHaveBeenCalledWith('{"type":"service_account"}');
  expect(getIdTokenClient).toHaveBeenCalledTimes(1);
  expect(getIdTokenClient).toHaveBeenCalledWith('https://w.run.app');
  expect(await minter.headers('https://w.run.app/jobs')).toEqual({ Authorization: 'Bearer tok' });
});

it('accepts a Headers instance from the library and flattens it', async () => {
  const getRequestHeaders = jest.fn().mockResolvedValue(new Headers({ authorization: 'Bearer h' }));
  const minter = new IdTokenMinter(null, () => ({
    getIdTokenClient: async () => ({ getRequestHeaders }),
  }));
  expect(await minter.headers('https://w/x')).toEqual({ authorization: 'Bearer h' });
});
