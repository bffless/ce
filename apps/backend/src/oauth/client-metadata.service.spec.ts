import {
  CIMD_CLIENT_NAMESPACE,
  CIMD_DEFAULT_TTL_MS,
  CIMD_MAX_TTL_MS,
  ClientMetadataService,
  ClientMetadataTransport,
  assertClientIdUrl,
  isPublicAddress,
  parseClientMetadataDocument,
  pinnedLookup,
  readCapped,
  ttlFrom,
} from './client-metadata.service';
import { OAuthError } from './oauth.errors';
import { Test } from '@nestjs/testing';

const URL_ = 'https://claude.ai/.well-known/oauth-client-metadata';
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: URL_,
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  logo_uri: 'https://claude.ai/logo.png',
  ...over,
});
const PUBLIC = [{ address: '104.18.1.1', family: 4 as const }];

function make(over: Partial<ClientMetadataTransport> = {}) {
  const transport = {
    lookup: jest.fn().mockResolvedValue(PUBLIC),
    fetch: jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      text: JSON.stringify(doc()),
    }),
    ...over,
  };
  return { service: new ClientMetadataService(transport as never), transport };
}

describe('ClientMetadataService — Client ID Metadata Documents (#741)', () => {
  it('is constructible by Nest with no transport bound (the network is the default)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ClientMetadataService],
    }).compile();
    const service = moduleRef.get(ClientMetadataService);
    expect(service.isClientIdUrl(URL_)).toBe(true);
    await expect(service.resolve('https://localhost/metadata')).rejects.toMatchObject({
      error: 'invalid_client',
    });
  });

  it('maps a URL to the same uuid every time, under a namespace that must never change', () => {
    const { service } = make();
    expect(service.isClientIdUrl(URL_)).toBe(true);
    expect(service.isClientIdUrl('http://x.example/m')).toBe(true);
    expect(service.isClientIdUrl('4a3c9d5e-0000-4000-8000-000000000000')).toBe(false);
    const id = service.clientIdFor(URL_);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(service.clientIdFor(URL_)).toBe(id);
    expect(service.clientIdFor('https://other.example/m')).not.toBe(id);
    expect(service.normalizeClientId(URL_)).toBe(id);
    expect(service.normalizeClientId('c1')).toBe('c1');
    // pinned: issued codes and refresh tokens reference the uuid this namespace produces
    expect(CIMD_CLIENT_NAMESPACE).toBe('5b7d4a3e-9c21-4f6e-8d0a-1e2f3c4b5a69');
    expect(service.clientIdFor('https://example.com/client')).toBe(
      '4a1038f8-a30c-5c55-904e-6259b04636e7',
    );
  });

  describe('resolve', () => {
    it('vets the host, fetches with the vetted addresses, reads the RFC 7591 fields, and caches', async () => {
      const { service, transport } = make();
      const out = await service.resolve(URL_);
      expect(transport.lookup).toHaveBeenCalledWith('claude.ai');
      expect(transport.fetch).toHaveBeenCalledWith(
        URL_,
        expect.objectContaining({ addresses: PUBLIC, signal: expect.any(AbortSignal) }),
      );
      expect(out).toEqual({
        clientId: URL_,
        clientName: 'Claude',
        clientUri: 'https://claude.ai',
        redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        tokenEndpointAuthMethod: 'none',
      });
      await service.resolve(URL_);
      expect(transport.fetch).toHaveBeenCalledTimes(1);
      service.clearCache();
      await service.resolve(URL_);
      expect(transport.fetch).toHaveBeenCalledTimes(2);
    });
    it('does not cache a document that says no-store, and re-fetches after max-age', async () => {
      const { service, transport } = make({
        fetch: jest.fn().mockResolvedValue({
          status: 200,
          headers: { get: () => 'no-store' },
          text: JSON.stringify(doc()),
        }),
      });
      await service.resolve(URL_);
      await service.resolve(URL_);
      expect(transport.fetch).toHaveBeenCalledTimes(2);
      expect(ttlFrom(null)).toBe(CIMD_DEFAULT_TTL_MS);
      expect(ttlFrom('public, max-age=60')).toBe(60_000);
      expect(ttlFrom('max-age=0')).toBe(0);
      expect(ttlFrom('max-age=999999999')).toBe(CIMD_MAX_TTL_MS);
      expect(ttlFrom('no-cache')).toBe(CIMD_DEFAULT_TTL_MS);
    });
    it('refuses a host that resolves to any non-public address, without fetching', async () => {
      const { service, transport } = make({
        lookup: jest.fn().mockResolvedValue([
          { address: '104.18.1.1', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
      });
      await expect(service.resolve(URL_)).rejects.toMatchObject({
        error: 'invalid_client',
        status: 401,
      });
      expect(transport.fetch).not.toHaveBeenCalled();
      const unresolved = make({ lookup: jest.fn().mockRejectedValue(new Error('ENOTFOUND')) });
      await expect(unresolved.service.resolve(URL_)).rejects.toMatchObject({
        error: 'invalid_client',
      });
      const empty = make({ lookup: jest.fn().mockResolvedValue([]) });
      await expect(empty.service.resolve(URL_)).rejects.toMatchObject({ error: 'invalid_client' });
    });
    it('a fetch failure, a redirect, a non-JSON body, or a document naming another client_id is invalid_client', async () => {
      const failing = make({ fetch: jest.fn().mockRejectedValue(new Error('timeout')) });
      await expect(failing.service.resolve(URL_)).rejects.toMatchObject({
        error: 'invalid_client',
        description: 'the client metadata document could not be fetched',
      });
      const redirect = make({
        fetch: jest.fn().mockResolvedValue({ status: 302, headers: { get: () => null }, text: '' }),
      });
      await expect(redirect.service.resolve(URL_)).rejects.toMatchObject({
        description: 'the client metadata document answered 302',
      });
      const html = make({
        fetch: jest
          .fn()
          .mockResolvedValue({ status: 200, headers: { get: () => null }, text: '<html>' }),
      });
      await expect(html.service.resolve(URL_)).rejects.toMatchObject({
        description: 'the client metadata document is not JSON',
      });
      const other = make({
        fetch: jest.fn().mockResolvedValue({
          status: 200,
          headers: { get: () => null },
          text: JSON.stringify(doc({ client_id: 'https://claude.ai/other' })),
        }),
      });
      await expect(other.service.resolve(URL_)).rejects.toMatchObject({ error: 'invalid_client' });
      // none of those are cached
      expect(other.transport.fetch).toHaveBeenCalledTimes(1);
      await expect(other.service.resolve(URL_)).rejects.toThrow(OAuthError);
      expect(other.transport.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('assertClientIdUrl', () => {
    it('accepts an https URL naming a public domain (a port and a query are fine)', () => {
      expect(assertClientIdUrl(URL_).hostname).toBe('claude.ai');
      expect(assertClientIdUrl('https://example.com:8443/client?v=2').port).toBe('8443');
    });
    it.each([
      ['not a url', 'not-a-url'],
      ['http', 'http://claude.ai/metadata'],
      ['credentials', 'https://user:pw@claude.ai/metadata'],
      ['fragment', 'https://claude.ai/metadata#frag'],
      ['dot segment', 'https://claude.ai/a/../metadata'],
      ['single dot', 'https://claude.ai/./metadata'],
      ['ipv4 literal', 'https://169.254.169.254/latest/meta-data'],
      ['ipv6 literal', 'https://[::1]/metadata'],
      ['localhost', 'https://localhost/metadata'],
      ['single label', 'https://intranet/metadata'],
      ['.internal', 'https://metadata.google.internal/computeMetadata'],
      ['.svc', 'https://backend.default.svc/metadata'],
      ['.cluster.local', 'https://backend.default.svc.cluster.local/metadata'],
      ['.localhost', 'https://app.localhost/metadata'],
    ])('refuses %s', (_name, url) => {
      expect(() => assertClientIdUrl(url)).toThrow(OAuthError);
      try {
        assertClientIdUrl(url);
      } catch (error) {
        expect((error as OAuthError).error).toBe('invalid_client');
        expect((error as OAuthError).getStatus()).toBe(401);
      }
    });
  });

  describe('parseClientMetadataDocument', () => {
    it('reads the fields the way registration validates them; falls back to the hostname as a name', () => {
      expect(parseClientMetadataDocument(doc({ client_name: '  ' }), URL_).clientName).toBe(
        'claude.ai',
      );
      expect(
        parseClientMetadataDocument(doc({ grant_types: ['implicit'] }), URL_).grantTypes,
      ).toEqual(['authorization_code', 'refresh_token']);
      expect(
        parseClientMetadataDocument(doc({ grant_types: ['authorization_code'] }), URL_).grantTypes,
      ).toEqual(['authorization_code']);
      expect(
        parseClientMetadataDocument(doc({ token_endpoint_auth_method: 'private_key_jwt' }), URL_)
          .tokenEndpointAuthMethod,
      ).toBe('private_key_jwt');
      expect(parseClientMetadataDocument(doc({ client_uri: 7 }), URL_)).not.toHaveProperty(
        'clientUri',
      );
    });
    it.each([
      ['an array', []],
      ['a string', 'x'],
      ['no client_id', doc({ client_id: undefined })],
      ['another client_id', doc({ client_id: 'https://claude.ai/other' })],
      ['no redirect_uris', doc({ redirect_uris: undefined })],
      ['empty redirect_uris', doc({ redirect_uris: [] })],
      ['non-string redirect_uris', doc({ redirect_uris: [1] })],
      ['a plain-http remote redirect', doc({ redirect_uris: ['http://evil.example/cb'] })],
    ])('refuses %s', (_name, raw) => {
      expect(() => parseClientMetadataDocument(raw, URL_)).toThrow(OAuthError);
    });
    it('allows http on localhost as a redirect, like registration does', () => {
      expect(
        parseClientMetadataDocument(doc({ redirect_uris: ['http://localhost:8080/cb'] }), URL_)
          .redirectUris,
      ).toEqual(['http://localhost:8080/cb']);
    });
  });

  describe('isPublicAddress', () => {
    it.each([
      '104.18.1.1',
      '8.8.8.8',
      '203.0.113.9',
      '2606:4700::6810:1',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2002:808:808::',
    ])('%s is public', (ip) => expect(isPublicAddress(ip)).toBe(true));
    it.each([
      '127.0.0.1',
      '127.8.8.8',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '192.0.0.8',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2002:a00:1::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%eth0',
      'ff02::1',
      '2001:db8::1',
      'not-an-ip',
    ])('%s is not', (ip) => expect(isPublicAddress(ip)).toBe(false));
    it('a public IPv4 is not public when 172.15 / 172.32 style neighbours are mistaken for private', () => {
      expect(isPublicAddress('172.15.0.1')).toBe(true);
      expect(isPublicAddress('172.32.0.1')).toBe(true);
      expect(isPublicAddress('100.63.0.1')).toBe(true);
      expect(isPublicAddress('100.128.0.1')).toBe(true);
    });
  });

  describe('the connection is pinned to the vetted addresses', () => {
    it('answers net.connect from them, in both callback shapes', () => {
      const lookup = pinnedLookup([
        { address: '104.18.1.1', family: 4 },
        { address: '2606:4700::1', family: 6 },
      ]);
      const all = jest.fn();
      lookup('claude.ai', { all: true }, all);
      expect(all).toHaveBeenCalledWith(null, [
        { address: '104.18.1.1', family: 4 },
        { address: '2606:4700::1', family: 6 },
      ]);
      const one = jest.fn();
      lookup('claude.ai', {}, one);
      expect(one).toHaveBeenCalledWith(null, '104.18.1.1', 4);
      const short = jest.fn();
      lookup('claude.ai', short);
      expect(short).toHaveBeenCalledWith(null, '104.18.1.1', 4);
    });
  });

  describe('readCapped', () => {
    const stream = (...parts: string[]) =>
      (async function* () {
        for (const p of parts) yield Buffer.from(p);
      })();
    it('joins chunks under the cap and throws — stopping the read — past it', async () => {
      await expect(readCapped(stream('{"a":', '1}'), 100)).resolves.toBe('{"a":1}');
      await expect(readCapped(null, 100)).resolves.toBe('');
      let pulled = 0;
      const big = (async function* () {
        for (;;) {
          pulled += 1;
          yield Buffer.alloc(1024);
        }
      })();
      await expect(readCapped(big, 4096)).rejects.toThrow('exceeds 4096 bytes');
      expect(pulled).toBe(5);
    });
  });
});
