/**
 * Best-effort `source` provenance for `rules push` — stamped by the server onto the rule
 * set's `source` column so the UI can show "managed from git".
 *
 * Every field degrades independently and silently (a push from a laptop without git, or a
 * CI without the GitHub env vars, still works — it just carries less provenance):
 *
 * - `repo`: `GITHUB_REPOSITORY` env (`owner/repo`), else `git remote get-url origin`
 *   parsed to `owner/repo`.
 * - `gitSha`: `GITHUB_SHA` env, else `git rev-parse HEAD`.
 * - `path`: the rule-set directory relative to the repo root (`git rev-parse --show-toplevel`).
 *
 * `execGit` is injectable so tests never depend on the host repo's actual git state.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export type ExecGit = (args: string[], cwd: string) => string;

export interface GitSourceDeps {
  env?: Record<string, string | undefined>;
  execGit?: ExecGit;
}

export interface SourceMetadata {
  repo?: string;
  path?: string;
  gitSha?: string;
}

const defaultExecGit: ExecGit = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Parse a git remote URL (scp-like, ssh://, https://) to `owner/repo`. */
export function parseRepoFromRemoteUrl(url: string): string | undefined {
  // scp-like: git@github.com:owner/repo.git
  let m = /^[^@/]+@[^:/]+:(.+?)(?:\.git)?\/?$/.exec(url);
  // URL-style: https://host/owner/repo(.git), ssh://git@host/owner/repo.git
  if (!m) m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/i.exec(url);
  if (!m) return undefined;
  const parts = m[1].split('/').filter((p) => p.length > 0);
  if (parts.length < 2) return undefined;
  return parts.slice(-2).join('/');
}

/** `undefined` when nothing could be determined at all (the `source` key is then omitted). */
export function collectSourceMetadata(setDir: string, deps?: GitSourceDeps): SourceMetadata | undefined {
  const env = deps?.env ?? process.env;
  const execGit = deps?.execGit ?? defaultExecGit;
  const tryGit = (args: string[]): string | undefined => {
    try {
      const out = execGit(args, setDir);
      return out.length > 0 ? out : undefined;
    } catch {
      return undefined;
    }
  };

  const source: SourceMetadata = {};

  const envRepo = env.GITHUB_REPOSITORY;
  if (envRepo) {
    source.repo = envRepo;
  } else {
    const remoteUrl = tryGit(['remote', 'get-url', 'origin']);
    if (remoteUrl) {
      const parsed = parseRepoFromRemoteUrl(remoteUrl);
      if (parsed) source.repo = parsed;
    }
  }

  const gitSha = env.GITHUB_SHA ?? tryGit(['rev-parse', 'HEAD']);
  if (gitSha) source.gitSha = gitSha;

  const repoRoot = tryGit(['rev-parse', '--show-toplevel']);
  if (repoRoot) {
    const rel = path.relative(repoRoot, path.resolve(setDir));
    // A setDir outside the repo root (or the root itself) carries no useful path.
    if (rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      source.path = rel.split(path.sep).join('/');
    }
  }

  return Object.keys(source).length > 0 ? source : undefined;
}
