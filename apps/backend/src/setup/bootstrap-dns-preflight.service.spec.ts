// The serving model steers which port the reachability probe uses, so it is a
// mocked seam here (house pattern: primary-ssl.service.spec does the same).
// `deriveKnobs` stays real — the v1/env-adopted defaulting it encodes is
// exactly what we want exercised.
let mockInstanceConfig: unknown = null;
jest.mock('../bootstrap/instance-config', () => ({
  loadInstanceConfig: () => mockInstanceConfig,
  deriveKnobs: jest.requireActual('../bootstrap/instance-config').deriveKnobs,
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BootstrapDnsPreflightService } from './bootstrap-dns-preflight.service';

describe('BootstrapDnsPreflightService', () => {
  let webroot: string;
  let service: BootstrapDnsPreflightService;

  beforeEach(() => {
    webroot = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-webroot-'));
    process.env.CERTBOT_WEBROOT = webroot;
    delete process.env.PROXY_MODE;
    mockInstanceConfig = null;
    service = new BootstrapDnsPreflightService();
  });
  afterEach(() => {
    delete process.env.CERTBOT_WEBROOT;
    delete process.env.PROXY_MODE;
    fs.rmSync(webroot, { recursive: true, force: true });
  });

  it('passes when every host serves the probe token back', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue(['203.0.113.7'] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockImplementation(
        (async (_host: string, _ip: string, _token: string, content: string) => content) as never,
      );
    const res = await service.run('example.com');
    expect(res.ok).toBe(true);
    expect(res.checks.map((c) => c.host)).toEqual([
      'example.com',
      'www.example.com',
      'admin.example.com',
    ]);
    expect(res.checks.every((c) => c.probeOk)).toBe(true);
  });

  it('fails a host whose probe returns wrong content, keeps others green', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockImplementation((async (host: string, _ip: string, _t: string, content: string) =>
        host === 'www.example.com' ? 'someone else answered' : content) as never);
    const res = await service.run('example.com');
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.host === 'www.example.com')!.probeOk).toBe(false);
    expect(res.checks.find((c) => c.host === 'example.com')!.probeOk).toBe(true);
  });

  it('cleans up the probe file from the webroot', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockRejectedValue(new Error('unreachable') as never);
    await service.run('example.com');
    expect(fs.readdirSync(path.join(webroot, '.well-known', 'acme-challenge'))).toEqual([]);
  });

  describe('m6: SSRF hardening — private/reserved resolutions are refused', () => {
    it.each([
      ['loopback', '127.0.0.1'],
      ['rfc1918', '10.1.2.3'],
      ['rfc1918-172', '172.16.5.5'],
      ['rfc1918-192', '192.168.1.1'],
      ['link-local/metadata', '169.254.169.254'],
      ['cgnat', '100.64.0.1'],
    ])('m6: refuses to probe a host resolving to %s', async (_label, ip) => {
      jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([ip] as never);
      const fetchSpy = jest.spyOn(service as never, 'fetchProbe' as never);
      const result = await service.run('internal.example.com');
      expect(result.ok).toBe(false);
      expect(result.checks[0].error).toContain('private or reserved');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('m6: public addresses still probe', async () => {
      jest
        .spyOn(service as never, 'resolveA' as never)
        .mockResolvedValue(['93.184.216.34'] as never);
      jest.spyOn(service as never, 'fetchProbe' as never).mockResolvedValue('tokenbody' as never);
      const result = await service.run('example.com');
      expect(result.checks[0].error === 'resolves to a private or reserved address').toBe(false);
    });
  });

  describe('m6 TOCTOU fix: probe connects to the vetted IP, not the hostname', () => {
    it('pins the connection to the resolved IP and sends the real hostname via the Host header', async () => {
      jest
        .spyOn(service as never, 'resolveA' as never)
        .mockResolvedValue(['93.184.216.34'] as never);
      const transportSpy = jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockResolvedValue({ statusCode: 200, body: '' } as never);

      await service.run('example.com');

      // `run()` probes apex/www/admin CONCURRENTLY, so the order calls land in
      // is not deterministic — assert over the whole set rather than calls[0],
      // which raced and failed intermittently in CI.
      expect(transportSpy).toHaveBeenCalledTimes(3);
      type ProbeOptions = {
        host: string;
        headers: Record<string, string>;
        path: string;
      };
      const calls = (transportSpy.mock.calls as unknown as Array<[ProbeOptions]>).map(
        ([options]) => options,
      );

      for (const options of calls) {
        // Connection target must be the already-vetted IP — never the raw
        // hostname, which would let the HTTP client re-resolve DNS itself and
        // reopen the resolve/connect TOCTOU window. This must hold for EVERY
        // probed host, not just the first one to fire.
        expect(options.host).toBe('93.184.216.34');
        expect(options.path).toMatch(/^\/\.well-known\/acme-challenge\//);
      }

      // The hostname still travels via the Host header so ACME webroot
      // vhost routing on the target server keeps working.
      expect(calls.map((options) => options.headers.Host).sort()).toEqual([
        'admin.example.com',
        'example.com',
        'www.example.com',
      ]);
    });
  });

  describe('probeHost extraction', () => {
    it('probeHost probes exactly the given host', async () => {
      const resolveA = jest
        .spyOn(service as never, 'resolveA' as never)
        .mockResolvedValue(['203.0.113.7'] as never);
      jest.spyOn(service as never, 'fetchProbe' as never).mockResolvedValue('irrelevant' as never);
      const check = await service.probeHost('handoff.example.com');
      expect(check.host).toBe('handoff.example.com');
      expect(resolveA).toHaveBeenCalledTimes(1);
    });

    it('run() still fans out to apex + www + admin via probeHost', async () => {
      const probe = jest
        .spyOn(service, 'probeHost')
        .mockResolvedValue({ host: 'x', resolvedIps: [], probeOk: true });
      await service.run('example.com');
      expect(probe.mock.calls.map((c) => c[0])).toEqual([
        'example.com',
        'www.example.com',
        'admin.example.com',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // The ACME gate must never be weakened by the reachability work. Everything
  // in this block is a regression fence around run(): it stays on port 80 with
  // a token echo REGARDLESS of the serving model, because that is the exact
  // route Let's Encrypt's HTTP-01 validator takes.
  // ---------------------------------------------------------------------------
  describe('run(): ACME semantics are unconditional', () => {
    it.each([
      ['direct', null],
      ['cloudflare', { version: 2, state: 'applied', proxyMode: 'cloudflare', port80: 'closed' }],
      ['proxy', { version: 2, state: 'applied', proxyMode: 'proxy', port80: 'redirect' }],
    ])('probes port 80 over plain HTTP with a token echo (%s instance)', async (_label, cfg) => {
      mockInstanceConfig = cfg;
      jest
        .spyOn(service as never, 'resolveA' as never)
        .mockResolvedValue(['93.184.216.34'] as never);
      const httpSpy = jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockImplementation((async (options: { path: string }) => ({
          statusCode: 200,
          // Echo the token back out of the request path, i.e. exactly what a
          // correctly-serving webroot does.
          body: options.path.replace('/.well-known/acme-challenge/', ''),
        })) as never);
      const httpsSpy = jest.spyOn(service as never, 'sendSecureProbeRequest' as never);

      const res = await service.run('example.com');

      expect(res.ok).toBe(true);
      expect(httpsSpy).not.toHaveBeenCalled();
      expect(httpSpy).toHaveBeenCalledTimes(3);
      type ProbeOptions = {
        host: string;
        port: number;
        path: string;
        headers: Record<string, string>;
      };
      const calls = (httpSpy.mock.calls as unknown as Array<[ProbeOptions]>).map(([o]) => o);
      for (const options of calls) {
        expect(options.port).toBe(80);
        expect(options.path).toMatch(/^\/\.well-known\/acme-challenge\//);
        // TOCTOU: connect to the vetted IP, carry the hostname in Host.
        expect(options.host).toBe('93.184.216.34');
      }
      expect(calls.map((o) => o.headers.Host).sort()).toEqual([
        'admin.example.com',
        'example.com',
        'www.example.com',
      ]);
      expect(res.checks.every((c) => c.probeKind === 'acme')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Reachability mode: the app catalog's question, not the CA's.
  // ---------------------------------------------------------------------------
  describe('probeHost({ mode: "reachability" })', () => {
    function stubResolve(ip = '93.184.216.34') {
      jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([ip] as never);
    }
    function stubHttps(statusCode: number) {
      return jest
        .spyOn(service as never, 'sendSecureProbeRequest' as never)
        .mockResolvedValue({ statusCode, body: '' } as never);
    }

    it.each([
      ['proxyMode cloudflare', { version: 2, state: 'applied', proxyMode: 'cloudflare' }],
      ['proxyMode proxy', { version: 2, state: 'applied', proxyMode: 'proxy' }],
      // port80 'closed' on its own is enough: whatever the proxyMode label
      // says, nginx renders `return 444` and no ACME location there.
      ['port80 closed', { version: 2, state: 'applied', proxyMode: 'none', port80: 'closed' }],
    ])('probes HTTPS on 443 when %s', async (_label, cfg) => {
      mockInstanceConfig = cfg;
      stubResolve();
      const httpsSpy = stubHttps(404);
      const httpSpy = jest.spyOn(service as never, 'sendProbeRequest' as never);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).toHaveBeenCalledTimes(1);
      expect((httpsSpy.mock.calls[0] as unknown as [{ port: number }])[0].port).toBe(443);
      expect(check.probeKind).toBe('https-reachability');
    });

    // Reachability mode must NEVER run the ACME token echo, on ANY serving
    // model. That probe answers "could Let's Encrypt validate this host?",
    // which is a different and strictly harder question — wrong in both
    // directions for this gate:
    //
    //  - FALSE FAILURES. Behind a Cloudflare Tunnel (Umbrel) an unmapped
    //    subdomain answers 404, and fetchProbe rejects every non-2xx
    //    ("HTTP 404 from <host>"), so the install gate blocked permanently on
    //    a host that was perfectly reachable.
    //  - FALSE PASSES. On a direct-serving instance the echo only succeeded
    //    because the request fell through to the PRIMARY vhost's ACME
    //    location; it never measured the app host at all, and the same probe
    //    fails once that host has a vhost of its own (ce#584).
    it('probes port 80 for reachability on a direct-serving instance, not the token echo', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'none', port80: 'redirect' };
      stubResolve();
      const httpsSpy = jest.spyOn(service as never, 'sendSecureProbeRequest' as never);
      const httpSpy = jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockResolvedValue({ statusCode: 404, body: '' } as never);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(httpsSpy).not.toHaveBeenCalled();
      const opts = (httpSpy.mock.calls[0] as unknown as [{ port: number; path: string }])[0];
      expect(opts.port).toBe(80);
      // Plain '/', NOT an acme-challenge token path.
      expect(opts.path).toBe('/');
      expect(check.probeKind).toBe('http-reachability');
      // A 404 from our own server still proves the hostname arrives here.
      expect(check.probeOk).toBe(true);
      expect(check.status).toBe(404);
    });

    it('passes on the 404 an unmapped subdomain returns behind a tunnel (the Umbrel case)', async () => {
      // Umbrel writes no instance.json and sets no PROXY_MODE, so the serving
      // model resolves to 'none' — the branch that used to take the echo.
      mockInstanceConfig = null;
      delete process.env.PROXY_MODE;
      stubResolve('104.21.37.118');
      jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockResolvedValue({ statusCode: 404, body: '' } as never);

      const check = await service.probeHost('handoff.toshimoto.dev', { mode: 'reachability' });

      expect(check.probeOk).toBe(true);
      expect(check.status).toBe(404);
      expect(check.error).toBeUndefined();
    });

    it('never writes an ACME challenge file in reachability mode', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'none', port80: 'redirect' };
      stubResolve();
      jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockResolvedValue({ statusCode: 200, body: '' } as never);
      await service.probeHost('handoff.example.com', { mode: 'reachability' });

      // The ACME probe mints a token file in the webroot; reachability must not.
      expect(fs.existsSync(path.join(webroot, '.well-known', 'acme-challenge'))).toBe(false);
    });

    it('derives the serving model from PROXY_MODE when there is no instance.json', async () => {
      mockInstanceConfig = null;
      process.env.PROXY_MODE = 'cloudflare';
      stubResolve();
      const httpsSpy = stubHttps(404);

      await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(httpsSpy).toHaveBeenCalledTimes(1);
    });

    it('treats a 404 over HTTPS as success — the app has no mapping yet by definition', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      stubResolve();
      stubHttps(404);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(check.probeOk).toBe(true);
      expect(check.status).toBe(404);
      expect(check.error).toBeUndefined();
    });

    it.each([200, 301, 403, 500])('treats HTTP %s as a reachable answer', async (statusCode) => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      stubResolve();
      stubHttps(statusCode);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });
      expect(check.probeOk).toBe(true);
    });

    it.each([520, 521, 522, 523, 524, 525, 526, 527])(
      'fails a Cloudflare origin error (%s) with an origin-error classification',
      async (statusCode) => {
        mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
        stubResolve();
        stubHttps(statusCode);

        const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

        expect(check.probeOk).toBe(false);
        expect(check.failure).toBe('origin-error');
        expect(check.status).toBe(statusCode);
        expect(check.error).toMatch(/could not reach an origin/i);
      },
    );

    // Generic reverse proxies (nginx/Traefik/HAProxy) answer with plain
    // 502/503/504 when the backend is down — a strong backend-down signal that
    // must not read as "reachable". Scoped to proxied serving models: with no
    // proxy in the path a gateway status is the application's own answer.
    describe.each([
      ['cloudflare', { version: 2, state: 'applied', proxyMode: 'cloudflare' }],
      ['proxy', { version: 2, state: 'applied', proxyMode: 'proxy' }],
    ])('behind a %s proxy', (_label, cfg) => {
      it.each([502, 503, 504])('fails HTTP %s as origin-down', async (statusCode) => {
        mockInstanceConfig = cfg;
        stubResolve();
        stubHttps(statusCode);

        const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

        expect(check.probeOk).toBe(false);
        expect(check.failure).toBe('origin-down');
        expect(check.status).toBe(statusCode);
        expect(check.error).toMatch(/reached this server/i);
        expect(check.error).toMatch(/backend behind it did not return a valid response/i);
      });

      it.each([520, 524])('still fails Cloudflare %s as origin-error', async (statusCode) => {
        mockInstanceConfig = cfg;
        stubResolve();
        stubHttps(statusCode);

        const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });
        expect(check.failure).toBe('origin-error');
      });
    });

    // The one direct-serving config that still takes the HTTPS path: nothing
    // listens on 80, but no proxy sits in front either, so a 502 here is the
    // app's own response and still proves the hostname reaches this server.
    describe('direct-serving instance with port 80 closed', () => {
      const DIRECT_PORT80_CLOSED = {
        version: 2,
        state: 'applied',
        proxyMode: 'none',
        port80: 'closed',
      };

      it.each([502, 503, 504])('treats HTTP %s as a reachable answer', async (statusCode) => {
        mockInstanceConfig = DIRECT_PORT80_CLOSED;
        stubResolve();
        stubHttps(statusCode);

        const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

        expect(check.probeOk).toBe(true);
        expect(check.failure).toBeUndefined();
        expect(check.status).toBe(statusCode);
      });

      it('still fails a Cloudflare 520 — those are unambiguous whatever the model', async () => {
        mockInstanceConfig = DIRECT_PORT80_CLOSED;
        stubResolve();
        stubHttps(520);

        const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

        expect(check.probeOk).toBe(false);
        expect(check.failure).toBe('origin-error');
      });
    });

    it('fails with no-response when the connection is refused', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      stubResolve();
      jest
        .spyOn(service as never, 'sendSecureProbeRequest' as never)
        .mockRejectedValue(new Error('connect ECONNREFUSED 93.184.216.34:443') as never);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(check.probeOk).toBe(false);
      expect(check.failure).toBe('no-response');
      expect(check.error).toMatch(/ECONNREFUSED/);
    });

    it('fails with no-dns when the hostname does not resolve, without opening a socket', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([] as never);
      const httpsSpy = jest.spyOn(service as never, 'sendSecureProbeRequest' as never);

      const check = await service.probeHost('handoff.example.com', { mode: 'reachability' });

      expect(check.probeOk).toBe(false);
      expect(check.failure).toBe('no-dns');
      expect(httpsSpy).not.toHaveBeenCalled();
    });

    it('refuses a private/reserved resolution before connecting (SSRF guard holds in both modes)', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      stubResolve('169.254.169.254');
      const httpsSpy = jest.spyOn(service as never, 'sendSecureProbeRequest' as never);

      const check = await service.probeHost('metadata.example.com', { mode: 'reachability' });

      expect(check.probeOk).toBe(false);
      expect(check.failure).toBe('private-ip');
      expect(check.error).toContain('private or reserved');
      expect(httpsSpy).not.toHaveBeenCalled();
    });

    it('pins the HTTPS connection to the vetted IP and carries the hostname in SNI + Host', async () => {
      mockInstanceConfig = { version: 2, state: 'applied', proxyMode: 'cloudflare' };
      stubResolve('93.184.216.34');
      const httpsSpy = stubHttps(404);

      await service.probeHost('handoff.example.com', { mode: 'reachability' });

      const [options] = httpsSpy.mock.calls[0] as unknown as [
        {
          host: string;
          servername: string;
          headers: Record<string, string>;
          rejectUnauthorized: boolean;
        },
      ];
      // TOCTOU: never re-resolve — connect to the address we already vetted.
      expect(options.host).toBe('93.184.216.34');
      // SNI + Host still carry the hostname so the right vhost answers.
      expect(options.servername).toBe('handoff.example.com');
      expect(options.headers.Host).toBe('handoff.example.com');
      // Connecting by IP can never satisfy hostname verification, and origins
      // behind a proxy routinely serve self-signed certs — the probe proves
      // reachability, not authenticity.
      expect(options.rejectUnauthorized).toBe(false);
    });
  });
});
