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
  let service: EdgeBlocklistService;

  const blocklistService = {
    getCompiledState: jest.fn((): CompiledBlocklistState => state),
  } as unknown as BlocklistService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: unknown, out?: unknown) => void) =>
        cb(null, { stdout: '', stderr: '' }),
    );
    state = { enabled: true, blockSource: '(?:^/wp\\-admin)', allowSource: null };
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
    await expect(service.sync()).resolves.toBe(true);
    expect(service.getServerRules('444')).toBe('');
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
});
