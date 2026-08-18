import {
  RemoteConnectionsController,
  RemoteConnectionNamesController,
} from './remote-connections.controller';

describe('RemoteConnectionsController (admin settings)', () => {
  const status = [
    {
      id: 'c1',
      name: 'pdf-renderer',
      url: 'https://render.example.com',
      auth: 'google_id_token',
      hasCredential: true,
      maxInflight: 8,
      healthPath: '/health',
      source: {
        url: 'db',
        auth: 'db',
        credential: 'db',
        maxInflight: 'db',
        healthPath: 'db',
        envOnly: false,
      },
      envOnly: false,
      usedBy: { ffmpegExecutor: false, rules: 0 },
    },
  ];
  const service = {
    status: jest.fn(async () => status),
    create: jest.fn(async () => status[0]),
    update: jest.fn(async () => status[0]),
    remove: jest.fn(async () => undefined),
    test: jest.fn(async () => ({ ok: true, status: 200, latencyMs: 5, credential: 'none' })),
    list: jest.fn(() => [
      {
        name: 'pdf-renderer',
        auth: 'google_id_token',
        url: 'https://render.example.com',
        id: 'c1',
        credential: 'shh',
      },
    ]),
  };
  const controller = new RemoteConnectionsController(service as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET / calls service.status()', async () => {
    await expect(controller.list()).resolves.toEqual(status);
    expect(service.status).toHaveBeenCalledWith();
  });

  it('POST / forwards body + user id', async () => {
    const body = { name: 'pdf-renderer', url: 'https://render.example.com' };
    await controller.create(body, { id: 'u1' } as never);
    expect(service.create).toHaveBeenCalledWith(body, 'u1');
  });

  it('PUT /:id forwards id + body + user id', async () => {
    const body = { url: 'https://new.example.com' };
    await controller.update('c1', body, { id: 'u1' } as never);
    expect(service.update).toHaveBeenCalledWith('c1', body, 'u1');
  });

  it('DELETE /:id calls service.remove and returns nothing (204)', async () => {
    await expect(controller.remove('c1')).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('c1');
  });

  it('POST /test defaults the draft to {}', async () => {
    await controller.test(undefined as never);
    expect(service.test).toHaveBeenCalledWith({});
  });

  it('POST /test forwards a provided draft', async () => {
    const draft = { url: 'https://draft.example.com' };
    await controller.test(draft);
    expect(service.test).toHaveBeenCalledWith(draft);
  });

  it('is admin-only on every route (guard + Roles metadata)', () => {
    const roles = (m: string) =>
      Reflect.getMetadata('roles', (RemoteConnectionsController.prototype as any)[m]);
    expect(roles('list')).toEqual(['admin']);
    expect(roles('create')).toEqual(['admin']);
    expect(roles('update')).toEqual(['admin']);
    expect(roles('remove')).toEqual(['admin']);
    expect(roles('test')).toEqual(['admin']);
  });
});

describe('RemoteConnectionNamesController (any authenticated user)', () => {
  const service = {
    list: jest.fn(() => [
      {
        id: 'c1',
        name: 'pdf-renderer',
        url: 'https://render.example.com',
        auth: 'google_id_token',
        credential: 'super-secret',
        maxInflight: 8,
        healthPath: '/health',
        source: {
          url: 'db',
          auth: 'db',
          credential: 'db',
          maxInflight: 'db',
          healthPath: 'db',
          envOnly: false,
        },
      },
    ]),
  };
  const controller = new RemoteConnectionNamesController(service as never);

  it('GET / strips everything but name + auth', () => {
    expect(controller.names()).toEqual([{ name: 'pdf-renderer', auth: 'google_id_token' }]);
  });

  it('has no @Roles metadata (any authenticated user)', () => {
    const roles = Reflect.getMetadata(
      'roles',
      (RemoteConnectionNamesController.prototype as any).names,
    );
    expect(roles).toBeUndefined();
  });
});
