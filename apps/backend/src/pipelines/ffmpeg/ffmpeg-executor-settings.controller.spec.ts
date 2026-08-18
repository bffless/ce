import { FfmpegExecutorSettingsController } from './ffmpeg-executor-settings.controller';

describe('FfmpegExecutorSettingsController', () => {
  const service = {
    getStatus: jest.fn(async () => ({ remoteConnection: null })),
    update: jest.fn(async () => ({ remoteConnection: { name: 'ffmpeg' } })),
    testConnection: jest.fn(async () => ({ ok: true })),
  };
  const controller = new FfmpegExecutorSettingsController(service as never);

  it('GET returns status', async () => {
    await expect(controller.getStatus()).resolves.toEqual({ remoteConnection: null });
  });

  it('PUT forwards the body + user id and returns the new status', async () => {
    const body = { remoteEnabled: true, remoteConnection: 'ffmpeg' };
    await expect(controller.update(body, { id: 'u1' })).resolves.toEqual({
      remoteConnection: { name: 'ffmpeg' },
    });
    expect(service.update).toHaveBeenCalledWith(body, 'u1');
  });

  it('POST /test forwards the draft', async () => {
    await controller.test({ remoteConnection: 'pdf' });
    expect(service.testConnection).toHaveBeenCalledWith({ remoteConnection: 'pdf' });
  });

  it('is admin-only on every route (guard + Roles metadata)', () => {
    const roles = (m: string) =>
      Reflect.getMetadata('roles', (FfmpegExecutorSettingsController.prototype as any)[m]);
    expect(roles('getStatus')).toEqual(['admin']);
    expect(roles('update')).toEqual(['admin']);
    expect(roles('test')).toEqual(['admin']);
  });
});
