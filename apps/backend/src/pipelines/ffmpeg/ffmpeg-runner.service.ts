import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { readFfmpegEnv } from './ffmpeg-env';
import {
  FfmpegBusyError,
  FfmpegInsufficientMemoryError,
  FfmpegProcessError,
  FfmpegTimeoutError,
} from './ffmpeg-errors';

export interface FfmpegRunRequest {
  binary: 'ffmpeg' | 'ffprobe';
  args: string[];
  cwd: string;
  timeoutSeconds?: number;
}

export interface FfmpegRunResult {
  stdout: string;
  stderrTail: string;
}

/** Keep only the last N chars of stderr — enough for ffmpeg's actual error. */
const STDERR_TAIL_BYTES = 8192;
/** Headroom demanded beyond FFMPEG_MEMORY_MB before admitting a job (MB). */
const MEMORY_HEADROOM_MB = 128;
/** ffmpeg-only global flags: never prompt, never read stdin. */
const FFMPEG_GLOBAL_FLAGS = ['-nostdin', '-hide_banner', '-y'];
/** ffprobe shares only the cmdutils `-hide_banner` option — `-nostdin`/`-y` are ffmpeg-only and make ffprobe exit 1. */
const FFPROBE_GLOBAL_FLAGS = ['-hide_banner'];
/** Grace period after SIGKILL before we give up waiting for 'close' and self-heal by freeing the slot. */
const WATCHDOG_ESCALATION_MS = 30_000;

/** A caller parked in the FIFO queue, with the timer that bounds its wait. */
interface Waiter {
  resolve: (token: number) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The only place ffmpeg/ffprobe are spawned. Containment (all required by the
 * spec — a droplet-crash is the failure mode being designed against):
 *  - global concurrency 1, bounded FIFO queue (FFMPEG_QUEUE_MAX), fail-fast busy
 *  - cgroup memory pre-flight: refuse rather than gamble on the OOM killer
 *  - `prlimit --as` so ffmpeg (not the backend) dies on breach; `nice -n 10` +
 *    `-threads` (callers bake threads into argv) so the API stays interactive
 *  - SIGKILL watchdog (FFMPEG_MAX_SECONDS) for wedged processes; the queue wait
 *    is bounded too (FFMPEG_JOB_MAX_SECONDS) and a slot held past that ceiling
 *    is reclaimed, so no caller can park on the queue indefinitely (#669)
 * prlimit/nice may be absent outside Docker (dev hosts) — degrade with one warn.
 */
@Injectable()
export class FfmpegRunnerService {
  private readonly logger = new Logger(FfmpegRunnerService.name);
  /** Whoever holds the single slot. `since` is what makes a wedged slot detectable. */
  private holder: { token: number; since: number } | null = null;
  private tokenSeq = 0;
  private readonly waiting: Waiter[] = [];
  private warnedNoPrlimit = false;
  private warnedNoNice = false;

  async run(req: FfmpegRunRequest): Promise<FfmpegRunResult> {
    await this.assertMemoryHeadroom();
    const token = await this.acquire();
    try {
      return await this.spawnGuarded(req);
    } finally {
      this.release(token);
    }
  }

  // --- queue -----------------------------------------------------------

  /**
   * Longest a slot can legitimately be held: the job ceiling, never less than
   * what the process watchdog plus its escalation grace can take (an operator
   * lowering FFMPEG_JOB_MAX_SECONDS must not make live runs look wedged).
   */
  private holdCeilingMs(): number {
    const { jobMaxSeconds, maxSeconds } = readFfmpegEnv();
    return Math.max(jobMaxSeconds * 1000, maxSeconds * 1000 + WATCHDOG_ESCALATION_MS);
  }

  private take(): number {
    const token = ++this.tokenSeq;
    this.holder = { token, since: Date.now() };
    this.logger.debug({ event: 'ffmpeg_slot_acquired', token, queued: this.waiting.length });
    return token;
  }

  /** Give the free slot to the caller that has waited longest, if any. */
  private handOff(): void {
    const next = this.waiting.shift();
    if (!next) return;
    clearTimeout(next.timer);
    next.resolve(this.take());
  }

  /**
   * Self-heal beyond the watchdog-escalation path: a slot held past the ceiling
   * belongs to a caller that can no longer release it, so free it rather than
   * let the queue park behind a corpse for the life of the process (#669).
   */
  private reclaimIfWedged(): void {
    if (!this.holder || Date.now() - this.holder.since <= this.holdCeilingMs()) return;
    this.logger.error({
      event: 'ffmpeg_slot_reclaimed',
      token: this.holder.token,
      heldMs: Date.now() - this.holder.since,
    });
    this.holder = null;
    this.handOff(); // queued callers get it first — the reclaimer takes its turn below
  }

  private async acquire(): Promise<number> {
    this.reclaimIfWedged();
    if (!this.holder && this.waiting.length === 0) return this.take();

    const { queueMax, jobMaxSeconds } = readFfmpegEnv();
    if (this.waiting.length >= queueMax) {
      throw new FfmpegBusyError(
        `server busy: ffmpeg queue full (${this.waiting.length} waiting, max ${queueMax}) — retry later`,
      );
    }
    this.logger.debug({ event: 'ffmpeg_slot_queued', ahead: this.waiting.length });
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: undefined };
      // Bound the wait: without this a slot that never frees parks every later
      // job forever — no error, no log, nothing for a poller to observe.
      waiter.timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index === -1) return; // already handed the slot
        this.waiting.splice(index, 1); // never leave a departed waiter to be handed the slot
        this.logger.warn({ event: 'ffmpeg_slot_wait_timeout', waitedSeconds: jobMaxSeconds });
        reject(
          new FfmpegBusyError(
            `server busy: waited ${jobMaxSeconds}s for the ffmpeg slot without it freeing — retry later`,
          ),
        );
      }, jobMaxSeconds * 1000);
      this.waiting.push(waiter);
    });
  }

  private release(token: number): void {
    if (this.holder?.token !== token) return; // the slot was reclaimed under us
    this.holder = null;
    this.logger.debug({ event: 'ffmpeg_slot_released', token, queued: this.waiting.length });
    this.handOff();
  }

  // --- pre-flight --------------------------------------------------------

  /** cgroup v2 then v1; null = no limit readable (bare host) → skip the check. */
  private async readCgroupLimitBytes(): Promise<number | null> {
    for (const file of [
      '/sys/fs/cgroup/memory.max',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    ]) {
      try {
        const raw = (await fs.readFile(file, 'utf8')).trim();
        if (raw === 'max') return null;
        const n = Number(raw);
        // v1 reports a huge sentinel (~9.2e18) when unlimited
        if (Number.isFinite(n) && n > 0 && n < 2 ** 60) return n;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  private async assertMemoryHeadroom(): Promise<void> {
    const limit = await this.readCgroupLimitBytes();
    if (limit === null) return;
    const { memoryMb } = readFfmpegEnv();
    const needed = (memoryMb + MEMORY_HEADROOM_MB) * 1024 * 1024;
    const rss = process.memoryUsage().rss;
    if (limit - rss < needed) {
      throw new FfmpegInsufficientMemoryError(
        'insufficient memory for server video ops — raise the backend memory cap or lower FFMPEG_MEMORY_MB',
      );
    }
  }

  // --- spawn -------------------------------------------------------------

  /** Guard-wrapping fallback chain: prlimit+nice → nice → bare binary. */
  private commandChain(
    binary: FfmpegRunRequest['binary'],
    args: string[],
  ): Array<{ cmd: string; argv: string[] }> {
    const globalFlags = binary === 'ffprobe' ? FFPROBE_GLOBAL_FLAGS : FFMPEG_GLOBAL_FLAGS;
    const fullArgs = [...globalFlags, ...args];
    const memBytes = readFfmpegEnv().memoryMb * 1024 * 1024;
    return [
      { cmd: 'prlimit', argv: [`--as=${memBytes}`, '--', 'nice', '-n', '10', binary, ...fullArgs] },
      { cmd: 'nice', argv: ['-n', '10', binary, ...fullArgs] },
      { cmd: binary, argv: fullArgs },
    ];
  }

  private async spawnGuarded(req: FfmpegRunRequest): Promise<FfmpegRunResult> {
    const chain = this.commandChain(req.binary, req.args);
    const timeoutMs = (req.timeoutSeconds ?? readFfmpegEnv().maxSeconds) * 1000;

    for (let i = 0; i < chain.length; i++) {
      const { cmd, argv } = chain[i];
      try {
        return await this.spawnOnce(cmd, argv, req.cwd, timeoutMs);
      } catch (error) {
        const isSpawnEnoent =
          (error as NodeJS.ErrnoException).code === 'ENOENT' && i < chain.length - 1;
        if (!isSpawnEnoent) throw error;
        if (cmd === 'prlimit' && !this.warnedNoPrlimit) {
          this.warnedNoPrlimit = true;
          this.logger.warn(
            'prlimit not found — ffmpeg memory cap not enforced (install util-linux)',
          );
        }
        if (cmd === 'nice' && !this.warnedNoNice) {
          this.warnedNoNice = true;
          this.logger.warn('nice not found — ffmpeg runs at normal priority');
        }
      }
    }
    // Unreachable: the last chain entry rethrows.
    throw new Error('ffmpeg spawn chain exhausted');
  }

  private spawnOnce(
    cmd: string,
    argv: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<FfmpegRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderrTail = '';
      let timedOut = false;
      // Guards against a double-settle: if the escalation timer gives up and
      // rejects, a subsequent (late) 'close' from a kill that finally landed
      // must be a no-op rather than resolving/rejecting an already-settled promise.
      let settled = false;
      let escalation: ReturnType<typeof setTimeout> | undefined;

      const watchdog = setTimeout(() => {
        timedOut = true;
        this.logger.error({ event: 'ffmpeg_watchdog_kill', pid: child.pid, timeoutMs });
        child.kill('SIGKILL');
        // If SIGKILL doesn't land (e.g. uninterruptible I/O) 'close' never
        // fires, the promise never settles, and the queue slot leaks forever.
        // Give it a grace period, then self-heal: log loudly and free the slot.
        escalation = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.logger.error({ event: 'ffmpeg_watchdog_wedged', pid: child.pid });
          reject(
            new FfmpegTimeoutError(
              `ffmpeg watchdog killed the process after ${timeoutMs / 1000}s but it did not exit within ${WATCHDOG_ESCALATION_MS / 1000}s — freeing the slot`,
            ),
          );
        }, WATCHDOG_ESCALATION_MS);
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-STDERR_TAIL_BYTES);
      });

      child.on('error', (error) => {
        clearTimeout(watchdog);
        clearTimeout(escalation);
        if (settled) return; // already rejected by the wedged-watchdog escalation
        settled = true;
        reject(error); // ENOENT lands here → fallback chain
      });

      child.on('close', (code) => {
        clearTimeout(watchdog);
        clearTimeout(escalation);
        if (settled) return; // already rejected by the wedged-watchdog escalation
        settled = true;
        if (timedOut) {
          reject(
            new FfmpegTimeoutError(`ffmpeg watchdog killed the process after ${timeoutMs / 1000}s`),
          );
        } else if (code === 0) {
          resolve({ stdout, stderrTail });
        } else {
          // 137 = SIGKILL (address-space breach under prlimit shows up as an
          // ffmpeg malloc failure exit, cgroup kill as 137) — the message keeps
          // the tail so job rows get a human-readable failure.
          reject(
            new FfmpegProcessError(
              `ffmpeg exited with code ${code}: ${stderrTail.split('\n').filter(Boolean).pop() ?? 'no stderr'}`,
              code,
              stderrTail,
            ),
          );
        }
      });
    });
  }
}
