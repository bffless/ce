import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { STORAGE_ADAPTER, type IStorageAdapter } from '../../../storage/storage.interface';
import { readFfmpegEnv } from '../ffmpeg-env';
import { FfmpegStepTimeoutError } from '../ffmpeg-errors';
import { FfmpegRunnerService } from '../ffmpeg-runner.service';
import { FfmpegScratchService } from '../ffmpeg-scratch.service';
import type {
  FfmpegExecutor,
  FfmpegExecutorReadiness,
  FfmpegJob,
  FfmpegJobResult,
} from './ffmpeg-executor.interface';

/** ~64MB slack demanded beyond the 2× input estimate in the disk pre-flight. */
const DISK_MARGIN_BYTES = 64 * 1024 * 1024;
const PLACEHOLDER = /^\{(in|out|file):([^}]+)\}$/;

/**
 * "Local server": the CE backend materialises the job in a scratch dir, spawns each command through
 * FfmpegRunnerService (slot, memory pre-flight, prlimit/nice, watchdog) and streams outputs back to
 * storage. This is the pre-remote behaviour of FfmpegHandler, moved verbatim behind the executor seam.
 */
@Injectable()
export class LocalFfmpegExecutor implements FfmpegExecutor {
  readonly name = 'local' as const;

  constructor(
    private readonly runner: FfmpegRunnerService,
    private readonly scratch: FfmpegScratchService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  argvThreads(): number {
    return readFfmpegEnv().threads;
  }

  async ready(): Promise<FfmpegExecutorReadiness> {
    return { ok: true };
  }

  /**
   * `_opts.signal` is accepted for interface parity and deliberately ignored:
   * the local run has its own ceilings (the runner's watchdog, the per-call io
   * deadlines) and abandoning it early would leave the scratch dir and the
   * ffmpeg slot in the runner's hands anyway. Remote executors honour it.
   */
  async run(job: FfmpegJob, _opts: { signal: AbortSignal }): Promise<FfmpegJobResult> {
    const t0 = Date.now();
    const bytesIn = await this.inputSizeBytes(job.inputs.map((i) => i.key));
    await this.scratch.assertFreeSpace(2 * bytesIn + DISK_MARGIN_BYTES);
    const jobDir = await this.scratch.createJobDir();
    const local = (name: string) => path.join(jobDir, name);
    const known = new Set([...job.inputs, ...job.outputs, ...job.files].map((f) => f.name));
    try {
      const tIn = Date.now();
      for (const input of job.inputs) await this.downloadToFile(input.key, local(input.name));
      for (const file of job.files) await fs.writeFile(local(file.name), file.content);
      const transferInMs = Date.now() - tIn;

      const commands: FfmpegJobResult['commands'] = [];
      const failed = new Set<string>();
      let stdout = '';
      let stderrTail = '';
      const tRun = Date.now();
      for (const cmd of job.commands) {
        if (cmd.fallbackFor && !failed.has(cmd.fallbackFor)) {
          commands.push({ id: cmd.id, ran: false, exitCode: null });
          continue;
        }
        const args = cmd.argv.map((token) => {
          const m = PLACEHOLDER.exec(token);
          if (!m) return token;
          if (!known.has(m[2])) throw new Error(`ffmpeg job: unknown placeholder ${token}`);
          return local(m[2]);
        });
        try {
          const out = await this.runner.run({
            binary: cmd.kind,
            args,
            cwd: jobDir,
            timeoutSeconds: cmd.timeoutSeconds,
          });
          stdout = out.stdout;
          stderrTail = out.stderrTail;
          commands.push({ id: cmd.id, ran: true, exitCode: 0 });
        } catch (error) {
          // Only a process failure (stream mismatch) hands over to a declared
          // fallback; busy/timeout/memory bubble up untouched.
          const failure = error as { code?: string; exitCode?: number; stderrTail?: string };
          const hasFallback = job.commands.some((c) => c.fallbackFor === cmd.id);
          if (failure.code === 'FFMPEG_FAILED' && hasFallback) {
            failed.add(cmd.id);
            stderrTail = failure.stderrTail ?? stderrTail;
            commands.push({ id: cmd.id, ran: true, exitCode: failure.exitCode ?? null });
            continue;
          }
          throw error;
        }
      }
      const ffmpegMs = Date.now() - tRun;

      const tOut = Date.now();
      const outputs: FfmpegJobResult['outputs'] = [];
      let bytesOut = 0;
      for (const o of job.outputs) {
        const { size } = await this.uploadFromFile(local(o.name), o.key, o.contentType);
        outputs.push({ name: o.name, key: o.key, bytes: size });
        bytesOut += size;
      }
      const transferOutMs = Date.now() - tOut;
      return {
        executor: 'local',
        stdout,
        stderrTail,
        commands,
        outputs,
        bytesIn,
        bytesOut,
        timings: {
          queueMs: 0,
          transferInMs,
          ffmpegMs,
          transferOutMs,
          totalMs: Date.now() - t0,
        },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  // ---- moved verbatim from FfmpegHandler (withDeadline / io / downloadToFile / uploadFromFile / inputSizeBytes) ----

  /**
   * Bound an await that has no timeout of its own. On breach the step fails
   * with FFMPEG_JOB_TIMEOUT naming the phase; the abandoned work is left to
   * settle on its own (its `finally` still cleans up, and orphaned scratch
   * dirs are swept hourly) — the point is that the STEP always settles.
   */
  private withDeadline<T>(work: Promise<T>, seconds: number, phase: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // The abandoned work may reject later with nobody listening.
        work.catch(() => undefined);
        reject(
          new FfmpegStepTimeoutError(
            `ffmpeg_handler ${phase} exceeded ${seconds}s and was abandoned`,
          ),
        );
      }, seconds * 1000);
    });
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
  }

  /**
   * Storage calls are the unbounded awaits in this executor: an object-store
   * socket that stalls mid-transfer never errors and never completes. Each one
   * gets its own ceiling so the phase that stalled is named in the failure.
   */
  private io<T>(work: Promise<T>, phase: string): Promise<T> {
    return this.withDeadline(work, readFfmpegEnv().ioMaxSeconds, phase);
  }

  private async downloadToFile(key: string, destPath: string): Promise<void> {
    try {
      if (this.storageAdapter.downloadStream) {
        const { stream } = await this.io(
          this.storageAdapter.downloadStream(key),
          `download of ${key}`,
        );
        await this.io(pipeline(stream, createWriteStream(destPath)), `download of ${key}`);
      } else {
        // Non-streaming backend: buffered fallback (small instances only).
        const buffer = await this.io(this.storageAdapter.download(key), `download of ${key}`);
        await fs.writeFile(destPath, buffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found') || message.includes('ENOENT')) {
        throw Object.assign(new Error(`input not found in storage: ${key}`), {
          code: 'FILE_NOT_FOUND',
        });
      }
      throw error;
    }
  }

  private async uploadFromFile(
    srcPath: string,
    key: string,
    mimeType: string,
  ): Promise<{ size: number }> {
    const { size } = await fs.stat(srcPath);
    if (this.storageAdapter.uploadStream) {
      await this.io(
        this.storageAdapter.uploadStream(createReadStream(srcPath), key, size, { mimeType }),
        `upload of ${key}`,
      );
    } else {
      await this.io(
        this.storageAdapter.upload(await fs.readFile(srcPath), key, { mimeType }),
        `upload of ${key}`,
      );
    }
    return { size };
  }

  /** Sum of input object sizes for the disk pre-flight; unknown sizes count 0. */
  private async inputSizeBytes(keys: string[]): Promise<number> {
    let total = 0;
    for (const key of keys) {
      try {
        total +=
          (await this.io(this.storageAdapter.getMetadata(key), `metadata of ${key}`)).size ?? 0;
      } catch {
        /* pre-flight is best-effort; the FILE_NOT_FOUND surfaces at download */
      }
    }
    return total;
  }
}
