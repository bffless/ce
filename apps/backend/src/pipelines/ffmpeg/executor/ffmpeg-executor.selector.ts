import { Inject, Injectable, Optional } from '@nestjs/common';
import { FFMPEG_OPS, FfmpegCapabilityService } from '../ffmpeg-capability.service';
import { readFfmpegEnv } from '../ffmpeg-env';
import { FfmpegExecutorUnavailableError } from '../ffmpeg-errors';
import type { FfmpegExecutor, FfmpegExecutorName } from './ffmpeg-executor.interface';
import { FFMPEG_CONFIG, type FfmpegConfigResolver } from './ffmpeg-config.tokens';
import { LocalFfmpegExecutor } from './local-ffmpeg.executor';
import { RemoteFfmpegExecutor } from './remote/remote-ffmpeg.executor';

/**
 * The `/api/video/capabilities` payload (D6). `server`/`ops`/`version` are the
 * pre-remote fields — apps read them as-is — and everything else is additive:
 * `version` stays the LOCAL ffmpeg version (null when this box has no binaries);
 * the Worker's version lives under `remote.version`.
 */
export interface FfmpegCapabilityProbe {
  server: boolean;
  ops: string[];
  version: string | null;
  executors: FfmpegExecutorName[];
  defaultExecutor: FfmpegExecutorName;
  remote?: { version?: string; ready: boolean; reason?: string };
}

/**
 * The operator's policy flag ALONE — `isEnabled()` conflates it with local
 * binaries, which a remote-only instance deliberately does not have. The
 * optional call tolerates capability doubles written before `isFlagOn` existed.
 */
export function ffmpegFlagOn(capability: FfmpegCapabilityService): Promise<boolean> {
  return capability.isFlagOn?.() ?? capability.isEnabled();
}

/**
 * Which executor runs a step: the step's own `executor` if it named one, else
 * the instance default. Owns "enabled" (what the OPERATOR configured) versus
 * "ready" (what the executor itself reports right now) so the handler only ever
 * has to ask for an executor and map one error code.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md.
 */
@Injectable()
export class FfmpegExecutorSelector {
  constructor(
    private readonly local: LocalFfmpegExecutor,
    private readonly remote: RemoteFfmpegExecutor,
    private readonly capability: FfmpegCapabilityService,
    @Optional() @Inject(FFMPEG_CONFIG) private readonly env: FfmpegConfigResolver = readFfmpegEnv,
  ) {}

  /** Executors an operator has enabled: local iff binaries present AND localEnabled; remote iff remoteEnabled AND a Worker URL. */
  enabled(): FfmpegExecutorName[] {
    const cfg = this.env();
    const names: FfmpegExecutorName[] = [];
    if (this.capability.isAvailable() && cfg.localEnabled) names.push('local');
    if (cfg.remoteEnabled && cfg.remoteUrl) names.push('remote');
    return names;
  }

  /** FFMPEG_EXECUTOR when that executor is enabled, else the first enabled one, else 'local'. */
  defaultExecutor(): FfmpegExecutorName {
    const enabled = this.enabled();
    const configured = this.env().executor;
    if (enabled.includes(configured)) return configured;
    return enabled[0] ?? 'local';
  }

  /**
   * `requested` is the step's evaluated `executor` config (undefined = "instance
   * default"). Every refusal is FFMPEG_EXECUTOR_UNAVAILABLE with the reason in
   * the message — unknown name, not configured, or the executor itself not ready.
   */
  async pick(requested?: string): Promise<FfmpegExecutor> {
    const name = requested?.trim() || this.defaultExecutor();
    if (name !== 'local' && name !== 'remote') {
      throw new FfmpegExecutorUnavailableError(
        `ffmpeg_handler: unknown executor '${name}' (expected 'local' or 'remote')`,
      );
    }
    if (!this.enabled().includes(name)) {
      throw new FfmpegExecutorUnavailableError(
        name === 'remote'
          ? "ffmpeg_handler: executor 'remote' is not enabled on this instance (enable it in Admin Settings → Features → Server video ops, or set FFMPEG_REMOTE_URL)"
          : "ffmpeg_handler: executor 'local' is not enabled on this instance (needs ffmpeg installed and Local switched on in Admin Settings → Features → Server video ops)",
      );
    }
    const executor: FfmpegExecutor = name === 'local' ? this.local : this.remote;
    const readiness = await executor.ready();
    if (!readiness.ok) {
      throw new FfmpegExecutorUnavailableError(
        `ffmpeg_handler: executor '${name}' is not ready: ${readiness.reason ?? 'unknown reason'}`,
      );
    }
    return executor;
  }

  /** The capability payload (D6). `server` = the flag is on AND at least one enabled executor is ready. */
  async probe(): Promise<FfmpegCapabilityProbe> {
    const enabled = this.enabled();
    let anyReady = false;
    let remote: FfmpegCapabilityProbe['remote'];
    if (enabled.includes('local')) anyReady = (await this.local.ready()).ok;
    if (enabled.includes('remote')) {
      const readiness = await this.remote.ready();
      remote = {
        ready: readiness.ok,
        ...(readiness.version ? { version: readiness.version } : {}),
        ...(readiness.reason ? { reason: readiness.reason } : {}),
      };
      anyReady = anyReady || readiness.ok;
    }
    const server = (await ffmpegFlagOn(this.capability)) && anyReady;
    return {
      server,
      ops: server ? [...FFMPEG_OPS] : [],
      // The LOCAL binary's version — a remote-only instance has none to report.
      version: enabled.includes('local') ? this.capability.getVersion() : null,
      executors: enabled,
      defaultExecutor: this.defaultExecutor(),
      ...(remote ? { remote } : {}),
    };
  }
}
