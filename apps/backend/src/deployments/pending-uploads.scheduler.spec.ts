import { Logger } from '@nestjs/common';
import { PendingUploadsScheduler } from './pending-uploads.scheduler';
import { PendingUploadsService } from './pending-uploads.service';

describe('presigned upload temp sweep', () => {
  const pendingUploadsService = {} as unknown as PendingUploadsService;

  it('sweeps temp files older than an hour when local storage is active', async () => {
    const sweepTempFiles = jest.fn().mockResolvedValue(2);
    const scheduler = new PendingUploadsScheduler(
      pendingUploadsService,
      {
        getUnderlyingAdapter: () => ({ isLocalAdapter: true, getStorageBasePath: () => '/tmp/b' }),
      } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).toHaveBeenCalledWith('/tmp/b', 60 * 60 * 1000);
  });

  it('is a no-op when the active adapter is not local', async () => {
    // The non-local double deliberately lacks getStorageBasePath (and every
    // other local-only method): if resolveLocalAdapter's marker check were
    // ever dropped, calling through to it would throw, land in the try/catch,
    // and get logged as an error — leaving sweepTempFiles uncalled either
    // way. Asserting nothing was logged is what actually distinguishes
    // "correctly recognised as non-local and skipped" from "blew up and was
    // silently swallowed".
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const sweepTempFiles = jest.fn();
    const scheduler = new PendingUploadsScheduler(
      pendingUploadsService,
      { getUnderlyingAdapter: () => ({ isLocalAdapter: false }) } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('resolves through nested Dynamic(Caching(Local)) wrapping', async () => {
    const sweepTempFiles = jest.fn().mockResolvedValue(0);
    const scheduler = new PendingUploadsScheduler(
      pendingUploadsService,
      {
        getUnderlyingAdapter: () => ({
          // CachingStorageAdapter: no isLocalAdapter marker, wraps Local via getWrappedAdapter
          getWrappedAdapter: () => ({ isLocalAdapter: true, getStorageBasePath: () => '/tmp/c' }),
        }),
      } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).toHaveBeenCalledWith('/tmp/c', 60 * 60 * 1000);
  });
});
