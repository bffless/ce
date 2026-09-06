import 'reflect-metadata';
import { AppTokensController } from './app-tokens.controller';
import { PUBLIC_PROJECT_ACCESS_KEY } from '../auth/decorators/public-project-access.decorator';

describe('AppTokensController', () => {
  it('is session-only: SessionAuthGuard on the class, no ApiKeyGuard', () => {
    const guards = Reflect.getMetadata('__guards__', AppTokensController) ?? [];
    const names = guards.map((g: { name: string }) => g.name);
    expect(names).toEqual(['SessionAuthGuard']);
  });

  it('bypasses project-membership scoping like /api/me (cross-project by nature)', () => {
    expect(Reflect.getMetadata(PUBLIC_PROJECT_ACCESS_KEY, AppTokensController)).toBe(true);
  });

  it('delegates to the service and shapes the responses', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ view: { id: 't' }, raw: 'bfat_x' }),
      listMine: jest.fn().mockResolvedValue({ items: [{ id: 't' }], nextCursor: 'c' }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AppTokensController(service as never);
    const user = { id: 'u', role: 'user' };
    await expect(
      controller.create(user, { name: 'n', project: 'o/r', scopes: ['a:b'] }),
    ).resolves.toEqual({ data: { id: 't' }, token: 'bfat_x' });
    expect(service.create).toHaveBeenCalledWith('u', 'user', {
      name: 'n',
      project: 'o/r',
      scopes: ['a:b'],
    });
    await expect(controller.list(user, { includeInactive: true, limit: 10 })).resolves.toEqual({
      data: [{ id: 't' }],
      nextCursor: 'c',
    });
    expect(service.listMine).toHaveBeenCalledWith('u', { includeInactive: true, limit: 10 });
    await expect(controller.revoke(user, 't')).resolves.toBeUndefined();
    expect(service.revoke).toHaveBeenCalledWith('t', 'u');
  });
});
