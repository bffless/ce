import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectSourceMetadata, parseRepoFromRemoteUrl } from '../src/api/git-source.js';

const throwingGit = () => {
  throw new Error('git: command not found');
};

describe('parseRepoFromRemoteUrl', () => {
  it('parses scp-like, https, and ssh remotes to owner/repo', () => {
    expect(parseRepoFromRemoteUrl('git@github.com:bffless/ce.git')).toBe('bffless/ce');
    expect(parseRepoFromRemoteUrl('https://github.com/bffless/ce.git')).toBe('bffless/ce');
    expect(parseRepoFromRemoteUrl('https://github.com/bffless/ce')).toBe('bffless/ce');
    expect(parseRepoFromRemoteUrl('ssh://git@github.com/bffless/ce.git')).toBe('bffless/ce');
  });

  it('returns undefined for unparseable values', () => {
    expect(parseRepoFromRemoteUrl('not a url')).toBeUndefined();
    expect(parseRepoFromRemoteUrl('https://github.com/onlyowner')).toBeUndefined();
  });
});

describe('collectSourceMetadata', () => {
  it('prefers GITHUB_REPOSITORY / GITHUB_SHA env over git commands', () => {
    const source = collectSourceMetadata('/repo/apps/x/.bffless/proxy-rules/x', {
      env: { GITHUB_REPOSITORY: 'bffless/apps', GITHUB_SHA: 'abc123' },
      execGit: (args) => {
        if (args.includes('--show-toplevel')) return '/repo';
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      },
    });
    expect(source).toEqual({
      repo: 'bffless/apps',
      gitSha: 'abc123',
      path: 'apps/x/.bffless/proxy-rules/x',
    });
  });

  it('falls back to git remote/rev-parse when the GitHub env is absent', () => {
    const source = collectSourceMetadata('/repo/sets/a', {
      env: {},
      execGit: (args) => {
        if (args.join(' ') === 'remote get-url origin') return 'git@github.com:me/proj.git';
        if (args.join(' ') === 'rev-parse HEAD') return 'deadbeef';
        if (args.join(' ') === 'rev-parse --show-toplevel') return '/repo';
        throw new Error('unexpected');
      },
    });
    expect(source).toEqual({ repo: 'me/proj', gitSha: 'deadbeef', path: 'sets/a' });
  });

  it('returns undefined when git is unavailable and no env vars are set', () => {
    expect(collectSourceMetadata('/somewhere', { env: {}, execGit: throwingGit })).toBeUndefined();
  });

  it('degrades per-field: env sha only, no repo/path, still yields a partial source', () => {
    const source = collectSourceMetadata('/somewhere', {
      env: { GITHUB_SHA: 'cafef00d' },
      execGit: throwingGit,
    });
    expect(source).toEqual({ gitSha: 'cafef00d' });
  });

  it('omits path when the set dir is outside the repo root', () => {
    const source = collectSourceMetadata('/elsewhere/sets/a', {
      env: { GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 's' },
      execGit: (args) => {
        if (args.includes('--show-toplevel')) return path.resolve('/repo');
        throw new Error('unexpected');
      },
    });
    expect(source).toEqual({ repo: 'o/r', gitSha: 's' });
  });
});
