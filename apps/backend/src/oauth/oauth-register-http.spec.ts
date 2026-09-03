import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';

/**
 * The one scenario #742 exists for, end to end: claude.ai's registration body
 * through an app carrying the SAME global ValidationPipe as main.ts
 * (`forbidNonWhitelisted: true`). A parameter pipe cannot relax a global one —
 * Nest runs global pipes first — so the route takes its body untyped and
 * validates it itself; this proves the global pipe no longer 400s.
 */
describe('POST /api/oauth/register behind the app-wide ValidationPipe', () => {
  let app: INestApplication;
  const registerClient = jest.fn(async (dto: Record<string, unknown>) => ({
    client_id: 'c1',
    client_name: dto.client_name,
    redirect_uris: dto.redirect_uris,
    token_endpoint_auth_method: 'none',
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [{ provide: OAuthService, useValue: { registerClient } }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    // Exactly main.ts's pipe.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers claude.ai's body — unmodelled RFC 7591 fields stripped, a confidential method downgraded", async () => {
    const res = await request(app.getHttpServer())
      .post('/api/oauth/register')
      .send({
        client_name: 'Claude',
        client_uri: 'https://claude.ai',
        redirect_uris: [
          'https://claude.ai/api/mcp/auth_callback',
          'https://claude.com/api/mcp/auth_callback',
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        logo_uri: 'https://claude.ai/logo.png',
        contacts: ['support@anthropic.com'],
        software_id: 'claude',
        software_version: '1',
        tos_uri: 'https://claude.ai/tos',
        policy_uri: 'https://claude.ai/privacy',
      });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBe('c1');
    expect(res.headers['cache-control']).toBe('no-store');
    const dto = registerClient.mock.calls[0][0];
    expect(dto).toMatchObject({
      client_name: 'Claude',
      token_endpoint_auth_method: 'client_secret_post',
    });
    for (const stripped of [
      'logo_uri',
      'contacts',
      'software_id',
      'software_version',
      'tos_uri',
      'policy_uri',
    ]) {
      expect(dto).not.toHaveProperty(stripped);
    }
  });

  it("answers invalid metadata in the RFC shape, not Nest's", async () => {
    const res = await request(app.getHttpServer())
      .post('/api/oauth/register')
      .send({ client_name: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
    expect(typeof res.body.error_description).toBe('string');
    expect(res.body).not.toHaveProperty('statusCode');
  });
});
