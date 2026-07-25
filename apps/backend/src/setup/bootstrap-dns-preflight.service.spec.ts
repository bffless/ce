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
    service = new BootstrapDnsPreflightService();
  });
  afterEach(() => {
    delete process.env.CERTBOT_WEBROOT;
    fs.rmSync(webroot, { recursive: true, force: true });
  });

  it('passes when every host serves the probe token back', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue(['203.0.113.7'] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockImplementation((async (_host: string, _ip: string, _token: string, content: string) => content) as never);
    const res = await service.run('example.com');
    expect(res.ok).toBe(true);
    expect(res.checks.map((c) => c.host)).toEqual(['example.com', 'www.example.com', 'admin.example.com']);
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
    jest.spyOn(service as never, 'fetchProbe' as never).mockRejectedValue(new Error('unreachable') as never);
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
      jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue(['93.184.216.34'] as never);
      jest
        .spyOn(service as never, 'fetchProbe' as never)
        .mockResolvedValue('tokenbody' as never);
      const result = await service.run('example.com');
      expect(result.checks[0].error === 'resolves to a private or reserved address').toBe(false);
    });
  });

  describe('m6 TOCTOU fix: probe connects to the vetted IP, not the hostname', () => {
    it('pins the connection to the resolved IP and sends the real hostname via the Host header', async () => {
      jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue(['93.184.216.34'] as never);
      const transportSpy = jest
        .spyOn(service as never, 'sendProbeRequest' as never)
        .mockResolvedValue({ statusCode: 200, body: '' } as never);

      await service.run('example.com');

      expect(transportSpy).toHaveBeenCalled();
      const options = transportSpy.mock.calls[0][0] as {
        host: string;
        headers: Record<string, string>;
        path: string;
      };
      // Connection target must be the already-vetted IP — never the raw
      // hostname, which would let the HTTP client re-resolve DNS itself and
      // reopen the resolve/connect TOCTOU window.
      expect(options.host).toBe('93.184.216.34');
      expect(options.host).not.toBe('example.com');
      // The hostname still travels via the Host header so ACME webroot
      // vhost routing on the target server keeps working.
      expect(options.headers.Host).toBe('example.com');
      expect(options.path).toMatch(/^\/\.well-known\/acme-challenge\//);
    });
  });
});
