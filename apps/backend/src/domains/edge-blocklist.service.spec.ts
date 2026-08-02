import { EdgeBlocklistService } from './edge-blocklist.service';
import { BlocklistService, CompiledBlocklistState } from '../traffic/blocklist.service';

jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn().mockResolvedValue('/tmp/blocklist-validate-test'),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
}));

// promisify(execFile) wraps the callback-style mock, so implementations call
// the trailing callback with (error, { stdout, stderr }).
jest.mock('child_process', () => ({
  execFile: jest.fn((_cmd: string, _args: string[], cb: (err: unknown, out?: unknown) => void) =>
    cb(null, { stdout: '', stderr: '' }),
  ),
}));

import { execFile } from 'child_process';

const mockExecFile = execFile as unknown as jest.Mock;

describe('EdgeBlocklistService', () => {
  let state: CompiledBlocklistState;
  let domainStates: Map<string, CompiledBlocklistState>;
  let service: EdgeBlocklistService;

  const blocklistService = {
    getCompiledState: jest.fn((): CompiledBlocklistState => state),
    getCompiledDomainStates: jest.fn(() => domainStates),
  } as unknown as BlocklistService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown, out?: unknown) => void) =>
        cb(null, { stdout: '', stderr: '' }),
    );
    state = { enabled: true, blockSource: '(?:^/wp\\-admin)', allowSource: null };
    domainStates = new Map();
    service = new EdgeBlocklistService(blocklistService);
  });

  it('caches validated rules and renders both return-code variants', async () => {
    await expect(service.sync()).resolves.toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'nginx',
      expect.arrayContaining(['-t']),
      expect.any(Function),
    );
    expect(service.getServerRules('444')).toContain('return 444;');
    expect(service.getServerRules('403')).toContain('return 403;');
    expect(service.getServerRules('444')).toContain('^/wp\\-admin');
  });

  it('sync() is a no-op for an unchanged compiled state', async () => {
    await service.sync();
    mockExecFile.mockClear();
    await expect(service.sync()).resolves.toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('emits no rules while bot protection is disabled', async () => {
    state = { enabled: false, blockSource: '(?:^/wp\\-admin)', allowSource: null };
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toBe('');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rolls back to no edge rules when nginx -t rejects the snippet', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown) => void) => {
        const error = new Error('nginx: configuration file test failed') as Error & {
          stderr: string;
        };
        error.stderr = 'nginx: [emerg] invalid regex';
        cb(error);
      },
    );
    // No rules were applied before and none after, so there is nothing for a
    // caller to regenerate — sync() reports the APPLIED delta, not the
    // intended one (#607).
    await expect(service.sync()).resolves.toBe(false);
    expect(service.getServerRules('444')).toBe('');
  });

  it('reports a change when a rollback REMOVES rules that were applied', async () => {
    await service.sync();
    expect(service.getServerRules('444')).not.toBe('');

    state = { ...state, blockSource: '(?:^/wp\\-admin|^/new)' };
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: unknown) => void) => {
      const error = new Error('nginx: configuration file test failed') as Error & { stderr: string };
      error.stderr = 'nginx: [emerg] invalid regex';
      cb(error);
    });
    // Configs still carry the old rules; they must be rewritten without them.
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toBe('');
  });

  it('retries a rolled-back pair instead of latching on the fingerprint (#607)', async () => {
    // Regression: sync() recorded the fingerprint of the state it had just
    // ROLLED BACK, so every later sync short-circuited on it and the edge
    // rules stayed missing until a blocklist mutation changed the
    // fingerprint. One transient `nginx -t` failure during an upgrade was
    // enough to disable edge enforcement permanently.
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: unknown) => void) => {
      const error = new Error('nginx: configuration file test failed') as Error & { stderr: string };
      error.stderr = 'nginx: [emerg] invalid regex';
      cb(error);
    });
    await service.sync();
    expect(service.getServerRules('444')).toBe('');

    // Same compiled state, nginx healthy again: must re-validate and apply.
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown, out?: unknown) => void) =>
        cb(null, { stdout: '', stderr: '' }),
    );
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toContain('^/wp\\-admin');
  });

  it('reports no change while a rolled-back pair keeps failing', async () => {
    // Retrying is right; rewriting every nginx config every 30s is not.
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: unknown) => void) => {
      const error = new Error('nginx: configuration file test failed') as Error & { stderr: string };
      error.stderr = 'nginx: [emerg] invalid regex';
      cb(error);
    });
    await service.sync();
    mockExecFile.mockClear();

    await expect(service.sync()).resolves.toBe(false);
    expect(mockExecFile).toHaveBeenCalled(); // re-validated…
    expect(service.getServerRules('444')).toBe(''); // …but nothing changed.
  });

  it('accepts rules when only the sandbox environment fails (nginx reported syntax ok)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown) => void) => {
        const error = new Error('nginx: configuration file test failed') as Error & {
          stderr: string;
        };
        error.stderr =
          'nginx: the configuration file syntax is ok\nnginx: [emerg] open() "pid" failed (13: Permission denied)';
        cb(error);
      },
    );
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toContain('return 444;');
  });

  it('accepts rules when no nginx binary exists (validation falls back to charset guarantees)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown) => void) => {
        const error = new Error('spawn nginx ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        cb(error);
      },
    );
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toContain('return 444;');
  });

  it('picks up a toggle flip as a change and clears rules', async () => {
    await service.sync();
    expect(service.getServerRules('444')).not.toBe('');
    state = { ...state, enabled: false };
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toBe('');
  });

  it('renders the allow rescue when the effective set has allow entries', async () => {
    state = {
      enabled: true,
      blockSource: '(?:^/wp\\-admin)',
      allowSource: '(?:^/wp\\-admin/ok)',
    };
    await service.sync();
    const rules = service.getServerRules('444');
    expect(rules).toContain('^/wp\\-admin/ok');
    expect(rules.indexOf('set $blocklist_hit 1;')).toBeLessThan(
      rules.lastIndexOf('set $blocklist_hit 0;'),
    );
  });

  describe('per-domain rules (#393)', () => {
    it('resolves a domain-specific set, falling back to the default for other ids', async () => {
      domainStates = new Map([
        ['dom-1', { enabled: true, blockSource: '(?:^/wp\\-admin|^/custom)', allowSource: null }],
      ]);
      await expect(service.sync()).resolves.toBe(true);

      expect(service.getServerRules('444', 'dom-1')).toContain('^/custom');
      expect(service.getServerRules('444', 'dom-2')).not.toContain('^/custom');
      expect(service.getServerRules('444')).not.toContain('^/custom');
      expect(service.getServerRules('444', 'dom-2')).toContain('^/wp\\-admin');
    });

    it('validates each distinct source pair exactly once', async () => {
      domainStates = new Map([
        ['dom-1', { enabled: true, blockSource: '(?:^/custom)', allowSource: null }],
        ['dom-2', { enabled: true, blockSource: '(?:^/custom)', allowSource: null }],
      ]);
      await service.sync();
      // default pair + one shared per-domain pair = 2 nginx -t runs
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it('treats an attachment change as a sync change', async () => {
      await service.sync();
      domainStates = new Map([
        ['dom-1', { enabled: true, blockSource: '(?:^/custom)', allowSource: null }],
      ]);
      await expect(service.sync()).resolves.toBe(true);
      expect(service.getServerRules('403', 'dom-1')).toContain('^/custom');
    });

    it('rolls back only the invalid pair, keeping other domains enforced', async () => {
      domainStates = new Map([
        ['dom-1', { enabled: true, blockSource: '(?:^/custom)', allowSource: null }],
      ]);
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], cb: (err: unknown, out?: unknown) => void) => {
          // The sandbox config is written per-pair; reject only the run whose
          // rules contain the per-domain pattern (second call in sync order).
          const writes = (jest.requireMock('fs/promises').writeFile as jest.Mock).mock.calls;
          const lastConfig = String(writes[writes.length - 1]?.[1] ?? '');
          if (lastConfig.includes('^/custom')) {
            const error = new Error('nginx failed') as Error & { stderr: string };
            error.stderr = 'nginx: [emerg] invalid regex';
            cb(error);
            return;
          }
          cb(null, { stdout: '', stderr: '' });
        },
      );
      await service.sync();
      expect(service.getServerRules('444')).toContain('return 444;');
      expect(service.getServerRules('444', 'dom-1')).toBe('');
    });
  });
});
