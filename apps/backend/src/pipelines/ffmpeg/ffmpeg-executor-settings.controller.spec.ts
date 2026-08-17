import { FfmpegExecutorSettingsController } from './ffmpeg-executor-settings.controller';

describe('FfmpegExecutorSettingsController', () => {
  const service = {
    getStatus: jest.fn(async () => ({ hasSaKey: false })),
    update: jest.fn(async () => ({ hasSaKey: true })),
    testConnection: jest.fn(async () => ({ ok: true })),
  };
  const controller = new FfmpegExecutorSettingsController(service as never);

  it('GET returns status', async () => {
    await expect(controller.getStatus()).resolves.toEqual({ hasSaKey: false });
  });

  it('PUT forwards the body + user id and returns the new status', async () => {
    const body = {
      remoteEnabled: true,
      remoteUrl: 'https://w.example.com',
      saKeyJson: '{"type":"service_account"}',
    };
    await expect(controller.update(body, { id: 'u1' })).resolves.toEqual({ hasSaKey: true });
    expect(service.update).toHaveBeenCalledWith(body, 'u1');
  });

  it('POST /test forwards the draft', async () => {
    await controller.test({ remoteUrl: 'https://draft.example.com' });
    expect(service.testConnection).toHaveBeenCalledWith({ remoteUrl: 'https://draft.example.com' });
  });

  it('is admin-only on every route (guard + Roles metadata)', () => {
    const roles = (m: string) =>
      Reflect.getMetadata('roles', (FfmpegExecutorSettingsController.prototype as any)[m]);
    expect(roles('getStatus')).toEqual(['admin']);
    expect(roles('update')).toEqual(['admin']);
    expect(roles('test')).toEqual(['admin']);
  });
});
