import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TrafficEventsService } from './traffic-events.service';
import { TrafficEvent } from './traffic-event.interface';
import { createTrafficObserver, BlocklistEnforcer } from './traffic-observer.middleware';
import { buildBlocklistMatcher } from './blocklist-compiler';
import { BASELINE_BLOCKLIST_ENTRIES } from './blocklist-baseline';

/**
 * Seam 1 for #391: drive real HTTP requests through an app with the traffic
 * observer + Blocklist enforcement installed, and assert the blocked-case
 * response policy — bare 403, empty body, decided BEFORE routing, classified
 * and observed as 'blocked'. (The matched/Unmatched cases of the policy are
 * covered in traffic-http.spec.ts; the matcher itself in
 * blocklist-compiler.spec.ts.)
 */
describe('Blocklist enforcement at the HTTP boundary', () => {
  let app: INestApplication;
  let events: TrafficEventsService;
  let observed: TrafficEvent[];
  let subscription: { unsubscribe: () => void };

  // Swappable per test; the middleware holds only the reference.
  const baselineMatcher = buildBlocklistMatcher(BASELINE_BLOCKLIST_ENTRIES, []);
  let shouldBlock: (pathname: string) => boolean;
  const enforcer: BlocklistEnforcer = { shouldBlock: (pathname) => shouldBlock(pathname) };

  @Controller()
  class ProbeController {
    @Get('public/:owner/:repo/alias/:alias/*')
    serveContent(): string {
      return 'content';
    }

    @Get('api/traffic/requests')
    listRequests(): string {
      return 'admin api';
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [TrafficEventsService],
    }).compile();

    app = moduleRef.createNestApplication();
    events = app.get(TrafficEventsService);
    // Same wiring as main.ts: observer + enforcement above everything Nest routes.
    app.use(createTrafficObserver(events, enforcer));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    shouldBlock = (pathname) => baselineMatcher.isBlocked(pathname);
    observed = [];
    subscription = events.stream().subscribe((e) => observed.push(e));
  });

  afterEach(() => {
    subscription.unsubscribe();
  });

  const waitForEvents = async (count: number): Promise<void> => {
    const deadline = Date.now() + 1000;
    while (observed.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  it('refuses a blocklisted request with a bare 403 and empty body, observed as blocked', async () => {
    const res = await request(app.getHttpServer())
      .get('/wp-login.php')
      .set('X-Forwarded-For', '198.51.100.9')
      .set('User-Agent', 'scanner');

    expect(res.status).toBe(403);
    expect(res.text).toBe('');
    expect(res.headers['content-type']).toBeUndefined();

    await waitForEvents(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      classification: 'blocked',
      status: 403,
      bytes: 0,
      path: '/wp-login.php',
      ip: '198.51.100.9',
    });
  });

  it('enforces against the client-visible path from X-Original-URI, not the nginx rewrite', async () => {
    const res = await request(app.getHttpServer())
      .get('/public/acme/site/alias/production/.env')
      .set('X-Original-URI', '/.env?probe=1');

    expect(res.status).toBe(403);
    expect(res.text).toBe('');

    await waitForEvents(1);
    expect(observed[0].classification).toBe('blocked');
  });

  it('serves a clean content request normally', async () => {
    const res = await request(app.getHttpServer())
      .get('/public/acme/site/alias/production/index.html')
      .set('X-Original-URI', '/index.html');

    expect(res.status).toBe(200);
    expect(res.text).toBe('content');

    await waitForEvents(1);
    expect(observed[0].classification).toBe('matched');
  });

  it('never enforces on the app control surfaces, so the master toggle stays reachable', async () => {
    // A runaway pattern set that would block everything...
    shouldBlock = () => true;

    // ...still cannot block the admin API or auth.
    const api = await request(app.getHttpServer()).get('/api/traffic/requests');
    expect(api.status).toBe(200);
    const auth = await request(app.getHttpServer()).get('/auth/session/refresh');
    expect(auth.status).not.toBe(403);

    // Everything else is blocked as configured.
    const content = await request(app.getHttpServer()).get('/anything-else');
    expect(content.status).toBe(403);

    await waitForEvents(3);
    expect(observed.map((e) => e.classification)).toEqual(['matched', 'unmatched', 'blocked']);
  });

  it('blocks nothing when enforcement is off (master toggle)', async () => {
    shouldBlock = () => false;

    const res = await request(app.getHttpServer()).get('/wp-login.php');
    expect(res.status).toBe(404); // falls through to routing: Unmatched, not blocked

    await waitForEvents(1);
    expect(observed[0].classification).toBe('unmatched');
  });
});
