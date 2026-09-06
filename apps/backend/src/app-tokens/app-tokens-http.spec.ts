import 'reflect-metadata';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppTokensController } from './app-tokens.controller';
import { AppTokensService } from './app-tokens.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';

/**
 * `GET /api/app-tokens` query parsing on the wire — through the same global
 * `ValidationPipe` main.ts installs (`whitelist`, `transform`,
 * `forbidNonWhitelisted`). Query strings arrive as strings, so the DTO's
 * coercions (`includeInactive=true`, `limit=10`) and its rejections (an unknown
 * key, an out-of-range page size, a non-uuid cursor) only mean anything here.
 */
describe('GET /api/app-tokens over HTTP (global ValidationPipe installed)', () => {
  let app: INestApplication;
  const listMine = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppTokensController],
      providers: [{ provide: AppTokensService, useValue: { listMine } }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { id: 'user-1', role: 'user' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    listMine.mockReset().mockResolvedValue({ items: [{ id: 'tok-1' }], nextCursor: null });
  });

  it('a bare GET (a pinned client) still answers `data`, now with `nextCursor` beside it', async () => {
    const res = await request(app.getHttpServer()).get('/api/app-tokens');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 'tok-1' }], nextCursor: null });
    expect(listMine).toHaveBeenCalledWith('user-1', {});
  });

  it('coerces the query string into the typed options the service reads', async () => {
    const cursor = '11111111-1111-4111-8111-111111111111';
    const res = await request(app.getHttpServer()).get(
      `/api/app-tokens?includeInactive=true&limit=10&cursor=${cursor}`,
    );
    expect(res.status).toBe(200);
    expect(listMine).toHaveBeenCalledWith('user-1', { includeInactive: true, limit: 10, cursor });
  });

  it('400s an unknown parameter, an out-of-range limit and a malformed cursor', async () => {
    for (const qs of ['offset=10', 'limit=0', 'limit=201', 'limit=abc', 'cursor=not-a-uuid']) {
      const res = await request(app.getHttpServer()).get(`/api/app-tokens?${qs}`);
      expect([qs, res.status]).toEqual([qs, 400]);
    }
    expect(listMine).not.toHaveBeenCalled();
  });
});
