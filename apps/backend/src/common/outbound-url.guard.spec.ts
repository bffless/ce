import { BadRequestException, Logger } from '@nestjs/common';
import {
  enforceOutboundVerdict,
  guardOutboundHost,
  isExplicitlyInternalHost,
  isPublicAddress,
  outboundUrlGuardMode,
  OUTBOUND_LOOKUP_TIMEOUT_MS,
  OutboundLookupTimeoutError,
  pinnedLookup,
  readCapped,
  vetOutboundHost,
  vetOutboundHosts,
  withLookupTimeout,
  type HostLookup,
} from './outbound-url.guard';

const PUBLIC = [{ address: '104.18.1.1', family: 4 as const }];
const METADATA = [{ address: '169.254.169.254', family: 4 as const }];

describe('outbound-url.guard (#770)', () => {
  describe('isPublicAddress', () => {
    it.each([
      '104.18.1.1',
      '8.8.8.8',
      '203.0.113.9',
      '2606:4700::6810:1',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2002:808:808::',
      '2001:3::1',
      '2001:20::1',
      '100:1::1',
      '4000::1',
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
      '100::1',
      '2001:2::1',
      '2001:10::1',
      '2001:1f::1',
      '3fff::1',
      '3fff:ffff::1',
      'not-an-ip',
    ])('%s is not', (ip) => expect(isPublicAddress(ip)).toBe(false));
    it('does not mistake the neighbours of the private ranges for private', () => {
      expect(isPublicAddress('172.15.0.1')).toBe(true);
      expect(isPublicAddress('172.32.0.1')).toBe(true);
      expect(isPublicAddress('100.63.0.1')).toBe(true);
      expect(isPublicAddress('100.128.0.1')).toBe(true);
    });
  });

  describe('isExplicitlyInternalHost', () => {
    it.each([
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      'backend.default.svc',
      'backend.default.svc.cluster.local',
      'backend.default.svc.',
    ])('%s is declared internal', (host) => expect(isExplicitlyInternalHost(host)).toBe(true));
    it.each(['api.example.com', 'svc.example.com', 'localhost.example.com', '10.0.0.1', '::1'])(
      '%s is not',
      (host) => expect(isExplicitlyInternalHost(host)).toBe(false),
    );
  });

  describe('outboundUrlGuardMode', () => {
    it('defaults to warn when unset or blank', () => {
      expect(outboundUrlGuardMode(undefined)).toBe('warn');
      expect(outboundUrlGuardMode('')).toBe('warn');
      expect(outboundUrlGuardMode('  ')).toBe('warn');
    });
    it('reads warn / reject case-insensitively', () => {
      expect(outboundUrlGuardMode('warn')).toBe('warn');
      expect(outboundUrlGuardMode('reject')).toBe('reject');
      expect(outboundUrlGuardMode(' REJECT ')).toBe('reject');
    });
    it('treats an unknown value as warn and says so once', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        expect(outboundUrlGuardMode('strict-please')).toBe('warn');
        expect(outboundUrlGuardMode('strict-please')).toBe('warn');
        const calls = warn.mock.calls.filter((c) => String(c[0]).includes('strict-please'));
        expect(calls).toHaveLength(1);
        expect(String(calls[0][0])).toContain('OUTBOUND_URL_GUARD');
        expect(String(calls[0][0])).toContain('using warn');
      } finally {
        warn.mockRestore();
      }
    });
    it('reads the process environment by default', () => {
      const before = process.env.OUTBOUND_URL_GUARD;
      try {
        process.env.OUTBOUND_URL_GUARD = 'reject';
        expect(outboundUrlGuardMode()).toBe('reject');
        delete process.env.OUTBOUND_URL_GUARD;
        expect(outboundUrlGuardMode()).toBe('warn');
      } finally {
        if (before === undefined) delete process.env.OUTBOUND_URL_GUARD;
        else process.env.OUTBOUND_URL_GUARD = before;
      }
    });
  });

  describe('vetOutboundHost', () => {
    it('passes a name whose every address is public', async () => {
      const lookup: HostLookup = jest
        .fn()
        .mockResolvedValue([...PUBLIC, { address: '2606:4700::1', family: 6 }]);
      await expect(vetOutboundHost('api.example.com', lookup)).resolves.toEqual({
        ok: true,
        addresses: [...PUBLIC, { address: '2606:4700::1', family: 6 }],
      });
      expect(lookup).toHaveBeenCalledWith('api.example.com');
    });
    it('fails when any one address is non-public, naming the offenders', async () => {
      const lookup: HostLookup = jest.fn().mockResolvedValue([...PUBLIC, ...METADATA]);
      const verdict = await vetOutboundHost('api.example.com', lookup);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.reason).toBe('non-public');
      expect(verdict.detail).toContain('169.254.169.254');
      expect(verdict.detail).not.toContain('104.18.1.1');
    });
    it('is unresolved when the lookup throws or answers nothing', async () => {
      const throwing: HostLookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      const a = await vetOutboundHost('nope.example.com', throwing);
      expect(a).toMatchObject({ ok: false, reason: 'unresolved' });
      if (!a.ok) expect(a.detail).toContain('ENOTFOUND');
      const empty: HostLookup = jest.fn().mockResolvedValue([]);
      await expect(vetOutboundHost('nope.example.com', empty)).resolves.toMatchObject({
        ok: false,
        reason: 'unresolved',
      });
    });
    it('judges an IP literal as itself without a lookup, brackets and all', async () => {
      const lookup: HostLookup = jest.fn();
      await expect(vetOutboundHost('8.8.8.8', lookup)).resolves.toMatchObject({ ok: true });
      await expect(vetOutboundHost('100.64.0.1', lookup)).resolves.toMatchObject({
        ok: false,
        reason: 'non-public',
      });
      await expect(vetOutboundHost('[::ffff:10.0.0.1]', lookup)).resolves.toMatchObject({
        ok: false,
        reason: 'non-public',
      });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('guardOutboundHost', () => {
    const warnLogger = () => ({ warn: jest.fn() });

    it('is silent for a public host in either mode', async () => {
      const lookup: HostLookup = jest.fn().mockResolvedValue(PUBLIC);
      for (const mode of ['warn', 'reject'] as const) {
        const logger = warnLogger();
        await expect(
          guardOutboundHost('api.example.com', { subject: 's', mode, lookup, logger }),
        ).resolves.toMatchObject({ ok: true });
        expect(logger.warn).not.toHaveBeenCalled();
      }
    });
    it('warn: logs the subject and the verdict, and allows', async () => {
      const lookup: HostLookup = jest.fn().mockResolvedValue(METADATA);
      const logger = warnLogger();
      await expect(
        guardOutboundHost('api.example.com', {
          subject: 'proxy rule r1: target https://api.example.com',
          mode: 'warn',
          lookup,
          logger,
        }),
      ).resolves.toMatchObject({ ok: false, reason: 'non-public' });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const line = String(logger.warn.mock.calls[0][0]);
      expect(line).toContain('proxy rule r1');
      expect(line).toContain('169.254.169.254');
      expect(line).toContain('OUTBOUND_URL_GUARD=warn');
    });
    it('reject: throws a BadRequestException naming the env var', async () => {
      const lookup: HostLookup = jest.fn().mockResolvedValue(METADATA);
      const logger = warnLogger();
      const attempt = guardOutboundHost('api.example.com', {
        subject: 'app bundle https://api.example.com/a.zip',
        mode: 'reject',
        lookup,
        logger,
      });
      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow(
        /app bundle .*169\.254\.169\.254.*OUTBOUND_URL_GUARD=reject/,
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });
    it('reject: an unresolvable host is refused too', async () => {
      const lookup: HostLookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        guardOutboundHost('nope.example.com', { subject: 's', mode: 'reject', lookup }),
      ).rejects.toThrow(/does not resolve/);
    });
    it('takes the mode from the environment when none is given', async () => {
      const before = process.env.OUTBOUND_URL_GUARD;
      const lookup: HostLookup = jest.fn().mockResolvedValue(METADATA);
      try {
        process.env.OUTBOUND_URL_GUARD = 'reject';
        await expect(
          guardOutboundHost('api.example.com', { subject: 's', lookup }),
        ).rejects.toThrow(BadRequestException);
        delete process.env.OUTBOUND_URL_GUARD;
        await expect(
          guardOutboundHost('api.example.com', { subject: 's', lookup, logger: warnLogger() }),
        ).resolves.toMatchObject({ ok: false });
      } finally {
        if (before === undefined) delete process.env.OUTBOUND_URL_GUARD;
        else process.env.OUTBOUND_URL_GUARD = before;
      }
    });
  });

  describe('lookup timeout (#780)', () => {
    const never: HostLookup = () => new Promise(() => undefined);

    it('the default lookup budget is 3 s', () => {
      expect(OUTBOUND_LOOKUP_TIMEOUT_MS).toBe(3000);
    });

    it('withLookupTimeout rejects with OutboundLookupTimeoutError once the budget is spent', async () => {
      const bounded = withLookupTimeout(never, 20);
      const attempt = bounded('slow.example');
      await expect(attempt).rejects.toBeInstanceOf(OutboundLookupTimeoutError);
      await expect(attempt).rejects.toThrow('lookup of slow.example timed out after 20 ms');
    });

    it('withLookupTimeout passes a prompt answer or error through unchanged', async () => {
      const ok = withLookupTimeout(jest.fn().mockResolvedValue(PUBLIC), 1000);
      await expect(ok('api.example.com')).resolves.toEqual(PUBLIC);
      const bad = withLookupTimeout(jest.fn().mockRejectedValue(new Error('ENOTFOUND')), 1000);
      await expect(bad('nope.example.com')).rejects.toThrow('ENOTFOUND');
    });

    it('vetOutboundHost reports a timed-out lookup as `timeout` — could not be verified — not `unresolved`', async () => {
      const verdict = await vetOutboundHost('slow.example', withLookupTimeout(never, 20));
      expect(verdict).toMatchObject({ ok: false, reason: 'timeout', addresses: [] });
      if (verdict.ok) return;
      expect(verdict.detail).toContain('slow.example could not be verified');
      expect(verdict.detail).toContain('timed out after 20 ms');
    });

    it('guardOutboundHost: a timeout is allowed with a warning under warn and refused under reject', async () => {
      const lookup = withLookupTimeout(never, 20);
      const logger = { warn: jest.fn() };
      await expect(
        guardOutboundHost('slow.example', { subject: 's', mode: 'warn', lookup, logger }),
      ).resolves.toMatchObject({ ok: false, reason: 'timeout' });
      expect(String(logger.warn.mock.calls[0][0])).toMatch(
        /could not be verified.*allowed because OUTBOUND_URL_GUARD=warn/,
      );
      await expect(
        guardOutboundHost('slow.example', { subject: 's', mode: 'reject', lookup }),
      ).rejects.toThrow(/could not be verified.*OUTBOUND_URL_GUARD=reject/);
    });
  });

  describe('vetOutboundHosts — bulk, deduped, bounded (#780)', () => {
    const byName: Record<string, { address: string; family: 4 | 6 }[]> = {
      'a.example': PUBLIC,
      'b.example': METADATA,
    };

    it('resolves each distinct hostname once and maps every input (as given) to its verdict', async () => {
      const lookup: HostLookup = jest.fn(async (host) => byName[host] ?? []);
      const out = await vetOutboundHosts(
        ['a.example', 'b.example', 'A.example.', 'a.example', '10.0.0.1'],
        { lookup },
      );

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(lookup).toHaveBeenCalledWith('a.example');
      expect(lookup).toHaveBeenCalledWith('b.example');
      expect(out.size).toBe(4);
      expect(out.get('a.example')).toMatchObject({ ok: true });
      expect(out.get('A.example.')).toBe(out.get('a.example'));
      expect(out.get('b.example')).toMatchObject({ ok: false, reason: 'non-public' });
      expect(out.get('10.0.0.1')).toMatchObject({ ok: false, reason: 'non-public' });
    });

    it('keeps at most `concurrency` lookups in flight', async () => {
      let inFlight = 0;
      let peak = 0;
      const lookup: HostLookup = async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return PUBLIC;
      };
      const hosts = Array.from({ length: 6 }, (_, i) => `h${i}.example`);

      const out = await vetOutboundHosts(hosts, { lookup, concurrency: 2 });

      expect(peak).toBe(2);
      expect([...out.values()].every((v) => v.ok)).toBe(true);
    });

    it('one hanging name does not hide the others — each gets its own verdict', async () => {
      const lookup: HostLookup = withLookupTimeout(
        async (host) => (host === 'slow.example' ? new Promise(() => undefined) : PUBLIC),
        20,
      );
      const out = await vetOutboundHosts(['slow.example', 'a.example'], { lookup });
      expect(out.get('slow.example')).toMatchObject({ ok: false, reason: 'timeout' });
      expect(out.get('a.example')).toMatchObject({ ok: true });
    });

    it('an empty input is an empty map with no lookup', async () => {
      const lookup: HostLookup = jest.fn();
      await expect(vetOutboundHosts([], { lookup })).resolves.toEqual(new Map());
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('enforceOutboundVerdict — the policy on a ready verdict (#780)', () => {
    it('returns a passing verdict silently in either mode', () => {
      const logger = { warn: jest.fn() };
      for (const mode of ['warn', 'reject'] as const) {
        expect(
          enforceOutboundVerdict({ ok: true, addresses: PUBLIC }, { subject: 's', mode, logger }),
        ).toEqual({ ok: true, addresses: PUBLIC });
      }
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warn: logs the subject and detail and returns the verdict; reject: throws naming the env var', () => {
      const failing = {
        ok: false as const,
        reason: 'non-public' as const,
        addresses: METADATA,
        detail: 'api.example.com resolves to a non-public address (169.254.169.254)',
      };
      const logger = { warn: jest.fn() };
      expect(enforceOutboundVerdict(failing, { subject: 'rule r1', mode: 'warn', logger })).toBe(
        failing,
      );
      expect(String(logger.warn.mock.calls[0][0])).toBe(
        'rule r1: api.example.com resolves to a non-public address (169.254.169.254); allowed because OUTBOUND_URL_GUARD=warn',
      );
      expect(() => enforceOutboundVerdict(failing, { subject: 'rule r1', mode: 'reject' })).toThrow(
        BadRequestException,
      );
      expect(() => enforceOutboundVerdict(failing, { subject: 'rule r1', mode: 'reject' })).toThrow(
        'rule r1: api.example.com resolves to a non-public address (169.254.169.254); refused by OUTBOUND_URL_GUARD=reject',
      );
    });
  });

  describe('pinnedLookup — the connection is pinned to the vetted addresses', () => {
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
