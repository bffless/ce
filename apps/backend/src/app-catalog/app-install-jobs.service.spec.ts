import { BadRequestException } from '@nestjs/common';
import { AppInstallJobsService, type InstallStepId } from './app-install-jobs.service';

const STEPS: InstallStepId[] = ['preflight', 'fetch', 'sync-rules', 'deploy', 'record'];

describe('AppInstallJobsService', () => {
  let service: AppInstallJobsService;

  beforeEach(() => {
    service = new AppInstallJobsService();
  });

  describe('create', () => {
    it('creates a running job with every declared step pending, in order', () => {
      const job = service.create('install', 'handoff', STEPS);

      expect(job.id).toMatch(/^app-install-\d+/);
      expect(job.kind).toBe('install');
      expect(job.appId).toBe('handoff');
      expect(job.projectId).toBeNull();
      expect(job.status).toBe('running');
      expect(job.steps.map((s) => s.id)).toEqual(STEPS);
      expect(job.steps.every((s) => s.status === 'pending')).toBe(true);
      expect(job.createdAt).toEqual(expect.any(String));
      expect(job.finishedAt).toBeUndefined();
    });

    it('throws BadRequestException when another job is still running (single-flight)', () => {
      service.create('install', 'handoff', STEPS);

      expect(() => service.create('install', 'other-app', STEPS)).toThrow(BadRequestException);
      expect(() => service.create('update', 'handoff', STEPS)).toThrow(/already/i);
    });

    it('allows a new job once the previous one finished', () => {
      const first = service.create('install', 'handoff', STEPS);
      service.finish(first.id, 'succeeded');

      const second = service.create('update', 'handoff', STEPS);

      expect(second.status).toBe('running');
      expect(second.id).not.toBe(first.id);
    });

    it('gives concurrent-in-the-same-millisecond jobs distinct ids', () => {
      const first = service.create('install', 'handoff', STEPS);
      service.finish(first.id, 'succeeded');
      const second = service.create('install', 'handoff', STEPS);
      service.finish(second.id, 'succeeded');
      const third = service.create('install', 'handoff', STEPS);

      const ids = new Set([first.id, second.id, third.id]);
      expect(ids.size).toBe(3);
      expect(service.get(first.id)).not.toBeNull();
      expect(service.get(second.id)).not.toBeNull();
    });
  });

  describe('get', () => {
    it('returns the job by id', () => {
      const job = service.create('install', 'handoff', STEPS);
      expect(service.get(job.id)).toBe(job);
    });

    it('returns null for an unknown id', () => {
      expect(service.get('nope')).toBeNull();
    });
  });

  describe('setStep', () => {
    it('patches only the named step and leaves the others alone', () => {
      const job = service.create('install', 'handoff', STEPS);

      service.setStep(job.id, 'fetch', { status: 'running' });
      service.setStep(job.id, 'fetch', { status: 'done', detail: 'cached' });

      const fetchStep = service.get(job.id)!.steps.find((s) => s.id === 'fetch');
      expect(fetchStep).toEqual({ id: 'fetch', status: 'done', detail: 'cached' });
      expect(service.get(job.id)!.steps.find((s) => s.id === 'deploy')!.status).toBe('pending');
    });

    it('records failure detail on a step', () => {
      const job = service.create('install', 'handoff', STEPS);

      service.setStep(job.id, 'deploy', { status: 'failed', error: 'alias missing' });

      expect(service.get(job.id)!.steps.find((s) => s.id === 'deploy')).toEqual({
        id: 'deploy',
        status: 'failed',
        error: 'alias missing',
      });
    });

    it('is a no-op for an unknown job or an unknown step', () => {
      const job = service.create('install', 'handoff', STEPS);

      expect(() => service.setStep('nope', 'fetch', { status: 'done' })).not.toThrow();
      expect(() => service.setStep(job.id, 'domain', { status: 'done' })).not.toThrow();
      expect(service.get(job.id)!.steps.map((s) => s.id)).toEqual(STEPS);
    });
  });

  describe('finish', () => {
    it('sets the terminal status, stamps finishedAt and merges the patch', () => {
      const job = service.create('install', 'handoff', STEPS);

      service.finish(job.id, 'succeeded', {
        installedAppId: 'ia-1',
        appUrl: 'https://handoff.example.com',
        manualSteps: [{ id: 'bucket-cors', title: 'CORS', body: 'do it' }],
      });

      const finished = service.get(job.id)!;
      expect(finished.status).toBe('succeeded');
      expect(finished.finishedAt).toEqual(expect.any(String));
      expect(finished.installedAppId).toBe('ia-1');
      expect(finished.appUrl).toBe('https://handoff.example.com');
      expect(finished.manualSteps).toHaveLength(1);
    });

    it('records the error on a failed job', () => {
      const job = service.create('install', 'handoff', STEPS);

      service.finish(job.id, 'failed', { error: 'boom' });

      expect(service.get(job.id)!.status).toBe('failed');
      expect(service.get(job.id)!.error).toBe('boom');
    });

    it('is a no-op for an unknown job id', () => {
      expect(() => service.finish('nope', 'failed')).not.toThrow();
    });
  });

  describe('getActive / findByInstalledApp', () => {
    it('getActive returns the running job, and null once it finished', () => {
      const job = service.create('install', 'handoff', STEPS);
      expect(service.getActive()).toBe(job);

      service.finish(job.id, 'succeeded');
      expect(service.getActive()).toBeNull();
    });

    it('findByInstalledApp returns the most recent job for an installed app row', () => {
      const first = service.create('install', 'handoff', STEPS);
      service.finish(first.id, 'succeeded', { installedAppId: 'ia-1' });
      const second = service.create('update', 'handoff', STEPS);
      service.finish(second.id, 'succeeded', { installedAppId: 'ia-1' });

      expect(service.findByInstalledApp('ia-1')?.id).toBe(second.id);
      expect(service.findByInstalledApp('ia-2')).toBeNull();
    });
  });
});
