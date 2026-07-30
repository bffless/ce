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
    const sweepTempFiles = jest.fn();
    const scheduler = new PendingUploadsScheduler(
      pendingUploadsService,
      { getUnderlyingAdapter: () => ({ isLocalAdapter: false }) } as any,
      { sweepTempFiles } as any,
    );

    await scheduler.sweepPresignedTempFiles();

    expect(sweepTempFiles).not.toHaveBeenCalled();
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
