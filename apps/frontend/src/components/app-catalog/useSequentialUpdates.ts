import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { api } from '@/services/api';
import {
  appCatalogApi,
  useUpdateAppMutation,
  type InstallJob,
  type InstalledSummary,
} from '@/services/appCatalogApi';

export type SequentialUpdateStatus = 'queued' | 'running' | 'succeeded' | 'conflicts' | 'failed';

export interface SequentialUpdateState {
  status: SequentialUpdateStatus;
  jobId?: string;
  error?: string;
}

export interface SequentialUpdates {
  /** Per-install progress, keyed by `installedAppId`. Empty until `start` is called. */
  states: Record<string, SequentialUpdateState>;
  running: boolean;
  /** Kicks off the batch. No-op while one is already running. */
  start: (installs: InstalledSummary[], prune: boolean) => void;
}

const TERMINAL_JOB_STATUSES = new Set<InstallJob['status']>(['succeeded', 'failed', 'undone']);
const POLL_INTERVAL_MS = 1000;

/**
 * useSequentialUpdates — "Update all" for an app installed in several
 * projects. The backend's install-job registry is single-flight (a second
 * `updateApp` while one runs is a 400), so the batch is serialised here: fire
 * the update for one install, poll its job to a terminal status, then move to
 * the next. Each install's state is exposed so a list can render progress
 * inline; a finished job's id lets the row open the shared `InstallDialog`
 * (update mode) for the full step log and conflict resolution.
 *
 * A failed job does NOT stop the batch — the remaining installs are
 * independent rows and one project's failure says nothing about another's —
 * but a *rejected* start (e.g. another job already running) does, since every
 * later start would be rejected the same way. The catalog is re-fetched once
 * the batch ends so every row's version/updateAvailable is fresh.
 */
export function useSequentialUpdates(): SequentialUpdates {
  const dispatch = useAppDispatch();
  const [updateApp] = useUpdateAppMutation();
  const [states, setStates] = useState<Record<string, SequentialUpdateState>>({});
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const setState = useCallback((id: string, next: SequentialUpdateState) => {
    if (unmountedRef.current) return;
    setStates((prev) => ({ ...prev, [id]: next }));
  }, []);

  const pollJob = useCallback(
    async (jobId: string): Promise<InstallJob> => {
      for (;;) {
        const sub = dispatch(appCatalogApi.endpoints.getInstallJob.initiate(jobId, { forceRefetch: true }));
        try {
          const job = await sub.unwrap();
          if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
        } finally {
          sub.unsubscribe();
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    [dispatch],
  );

  const start = useCallback(
    (installs: InstalledSummary[], prune: boolean) => {
      if (runningRef.current || installs.length === 0) return;
      runningRef.current = true;
      setRunning(true);
      setStates(Object.fromEntries(installs.map((i) => [i.installedAppId, { status: 'queued' as const }])));

      void (async () => {
        let stopped = false;
        for (const install of installs) {
          const id = install.installedAppId;
          if (stopped) {
            setState(id, { status: 'failed', error: 'Skipped — an earlier update could not be started.' });
            continue;
          }
          setState(id, { status: 'running' });
          let jobId: string;
          try {
            ({ jobId } = await updateApp({ id, prune }).unwrap());
          } catch (err) {
            const message = (err as { data?: { message?: string } })?.data?.message ?? 'Update failed to start';
            setState(id, { status: 'failed', error: message });
            stopped = true;
            continue;
          }
          setState(id, { status: 'running', jobId });
          try {
            const job = await pollJob(jobId);
            if (job.status === 'succeeded') {
              setState(id, { status: job.conflicts?.length ? 'conflicts' : 'succeeded', jobId });
            } else {
              setState(id, { status: 'failed', jobId, error: job.error ?? `Update ${job.status}` });
            }
          } catch (err) {
            const message = (err as { data?: { message?: string } })?.data?.message ?? 'Lost track of the update job';
            setState(id, { status: 'failed', jobId, error: message });
          }
        }
        runningRef.current = false;
        if (!unmountedRef.current) {
          setRunning(false);
          dispatch(api.util.invalidateTags(['AppCatalog', 'InstalledApp']));
        }
      })();
    },
    [dispatch, pollJob, setState, updateApp],
  );

  return { states, running, start };
}
