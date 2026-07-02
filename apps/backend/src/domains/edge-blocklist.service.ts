import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { BlocklistService } from '../traffic/blocklist.service';
import {
  renderEdgeBlocklistRules,
  renderEdgeBlocklistSandboxConfig,
} from '../traffic/blocklist-nginx.util';

const execFileAsync = promisify(execFile);

/** A validated pair of compiled regex sources, ready to render. */
interface EdgeRuleSources {
  blockSource: string | null;
  allowSource: string | null;
}

/**
 * The edge enforcement seam (issues #392/#393, ADR-0002): turns
 * BlocklistService's compiled effective sets into validated nginx
 * server-block rules that NginxConfigService injects into every generated
 * per-domain config. Since #393 the effective set is per-domain: the default
 * set (Baseline + all-domains lists) plus, for domains with attachments,
 * their own compiled pair.
 *
 * sync() pulls the compiled states, renders the rules, and — when an nginx
 * binary is available — validates each DISTINCT source pair with `nginx -t`
 * against a sandboxed, self-contained config BEFORE it can ever reach
 * sites-enabled/. An invalid pair rolls back to "no edge rules" for the
 * domains using it (with a loud error): the app-side interceptor still
 * enforces the same set, so blocking degrades gracefully instead of a broken
 * config risking nginx startup. The compose watcher's full-config `nginx -t`
 * and nginx's own SIGHUP validation remain the final gates on the reload.
 *
 * getServerRules() is synchronous from the cache so config generators stay
 * simple; regeneration entry points call sync() first.
 */
@Injectable()
export class EdgeBlocklistService {
  private readonly logger = new Logger(EdgeBlocklistService.name);

  private fingerprint: string | null = null;
  private defaultSources: EdgeRuleSources = { blockSource: null, allowSource: null };
  /** Per-domain validated sources, only for domains that differ from the default. */
  private domainSources = new Map<string, EdgeRuleSources>();
  private warnedMissingNginx = false;

  constructor(private readonly blocklistService: BlocklistService) {}

  /**
   * Re-derive (and validate) the cached edge rules from the current compiled
   * Blocklist states. Returns true when the cached rules changed — callers use
   * that to decide whether a config regeneration is needed.
   */
  async sync(): Promise<boolean> {
    const state = this.blocklistService.getCompiledState();
    const domainStates = this.blocklistService.getCompiledDomainStates();

    const pairKey = (pair: EdgeRuleSources): string =>
      `${pair.blockSource ?? ''}~${pair.allowSource ?? ''}`;
    const domainPart = [...domainStates.entries()]
      .map(([id, s]) => `${id}=${pairKey(s)}`)
      .sort()
      .join(';');
    const fingerprint = `${state.enabled}|${pairKey(state)}|${domainPart}`;
    if (fingerprint === this.fingerprint) {
      return false;
    }

    // Disabled: edge rules are simply omitted everywhere.
    if (!state.enabled) {
      this.defaultSources = { blockSource: null, allowSource: null };
      this.domainSources = new Map();
      this.fingerprint = fingerprint;
      return true;
    }

    // Validate each DISTINCT pair once — most domains share the default set.
    const validated = new Map<string, EdgeRuleSources>();
    const validatePair = async (pair: EdgeRuleSources): Promise<EdgeRuleSources> => {
      const key = pairKey(pair);
      const cached = validated.get(key);
      if (cached) {
        return cached;
      }
      let result: EdgeRuleSources = { blockSource: pair.blockSource, allowSource: pair.allowSource };
      if (result.blockSource) {
        const rules = this.renderOrNull(result.blockSource, result.allowSource);
        const valid = rules !== null && (await this.validateWithNginx(rules));
        if (!valid) {
          this.logger.error(
            'Generated edge blocklist rules failed validation; omitting edge rules ' +
              '(app-side enforcement still applies)',
          );
          result = { blockSource: null, allowSource: null };
        }
      }
      validated.set(key, result);
      return result;
    };

    this.defaultSources = await validatePair(state);
    const domainSources = new Map<string, EdgeRuleSources>();
    for (const [id, domainState] of domainStates) {
      domainSources.set(id, await validatePair(domainState));
    }
    this.domainSources = domainSources;
    this.fingerprint = fingerprint;
    return true;
  }

  /**
   * The server-block rules for a generated config, from the last sync().
   * `domainMappingId` selects that domain's effective set (#393); omitted or
   * unknown ids get the default set (welcome page, redirect sources, mappings
   * created since the last sync). Empty string when bot protection is off,
   * the effective set is empty, or the last sync rolled back on a validation
   * failure.
   */
  getServerRules(returnCode: '444' | '403', domainMappingId?: string): string {
    const sources =
      (domainMappingId && this.domainSources.get(domainMappingId)) || this.defaultSources;
    const rules = this.renderOrNull(sources.blockSource, sources.allowSource, returnCode);
    return rules ?? '';
  }

  private renderOrNull(
    blockSource: string | null,
    allowSource: string | null,
    returnCode: '444' | '403' = '444',
  ): string | null {
    try {
      return renderEdgeBlocklistRules({ blockSource, allowSource, returnCode });
    } catch (error) {
      // A compiler-charset violation can only be a bug upstream; degrade to
      // app-side-only enforcement rather than emitting a suspect config.
      this.logger.error(`Edge blocklist rendering failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * `nginx -t` the rules inside a minimal sandbox config (no certs, no
   * upstreams — see renderEdgeBlocklistSandboxConfig). Returns true when the
   * config parses, and also when no nginx binary exists (dev environments):
   * the compiler's charset plus assertNginxSafeRegexSource make the snippet
   * safe by construction, and the nginx-side validators still gate the reload.
   */
  private async validateWithNginx(rules: string): Promise<boolean> {
    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'blocklist-validate-'));
      const confPath = join(dir, 'blocklist-validate.conf');
      await writeFile(confPath, renderEdgeBlocklistSandboxConfig(rules), 'utf-8');
      await execFileAsync('nginx', ['-t', '-q', '-p', dir, '-c', confPath]);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === 'ENOENT') {
        if (!this.warnedMissingNginx) {
          this.warnedMissingNginx = true;
          this.logger.warn(
            'No nginx binary found for blocklist rule validation; relying on charset ' +
              'guarantees and the nginx-side reload validators',
          );
        }
        return true;
      }
      // nginx separates parsing from environment checks: a config/regex error
      // never prints "syntax is ok", while environment failures (pid/log file
      // permissions in the sandbox) do. Only a parse failure should strip the
      // edge rules.
      if (err.stderr?.includes('syntax is ok')) {
        this.logger.warn(
          `nginx -t sandbox environment issue (rules accepted, syntax ok): ${err.stderr}`,
        );
        return true;
      }
      this.logger.error(`nginx -t rejected generated blocklist rules: ${err.stderr || String(error)}`);
      return false;
    } finally {
      if (dir) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
