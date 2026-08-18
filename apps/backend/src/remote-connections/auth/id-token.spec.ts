import { IdTokenMinter, NoAuth } from './id-token';
import { RemoteUnavailableError } from '../remote-errors';

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

it('a malformed credential (default factory, no mock) rejects with RemoteUnavailableError and never echoes the key text', async () => {
  // No factory override: this exercises the real `defaultAuthFactory`, whose
  // unguarded JSON.parse used to let V8's SyntaxError (which quotes a prefix of
  // the offending input) leak private-key bytes into the rejection message.
  const malformed = '{"type":"service_account","private_key":"BEGIN PRIVATE KEY zzz"';
  const minter = new IdTokenMinter(malformed);
  await expect(minter.headers('https://w/jobs')).rejects.toBeInstanceOf(RemoteUnavailableError);
  await expect(minter.headers('https://w/jobs')).rejects.toMatchObject({
    message: expect.not.stringContaining('BEGIN PRIVATE'),
  });
  await expect(minter.headers('https://w/jobs')).rejects.toMatchObject({
    message: expect.not.stringContaining('service_account'),
  });
});

it('does not cache a failed client creation — a later call retries', async () => {
  const getRequestHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer tok' });
  const getIdTokenClient = jest
    .fn()
    .mockRejectedValueOnce(new Error('could not load the default credentials'))
    .mockResolvedValueOnce({ getRequestHeaders });
  const minter = new IdTokenMinter(null, () => ({ getIdTokenClient }));
  await expect(minter.headers('https://w/jobs')).rejects.toThrow('default credentials');
  expect(await minter.headers('https://w/jobs')).toEqual({ Authorization: 'Bearer tok' });
  expect(getIdTokenClient).toHaveBeenCalledTimes(2);
});
