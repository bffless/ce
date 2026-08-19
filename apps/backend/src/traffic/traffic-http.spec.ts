import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PublicController } from '../deployments/public.controller';
import { DeploymentsService } from '../deployments/deployments.service';
import { ProjectsService } from '../projects/projects.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { VisibilityService } from '../domains/visibility.service';
import { TrafficRoutingService } from '../domains/traffic-routing.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ConfigService } from '@nestjs/config';
import { CacheConfigService } from '../cache-rules/cache-config.service';
import { MetadataCacheService } from '../storage/cache/metadata-cache.service';
import { ShareLinksService } from '../share-links/share-links.service';
import { ResponseHeaderConfigService } from '../response-header-rules/response-header-config.service';
import { STORAGE_ADAPTER } from '../storage/storage.interface';
import { TrafficEventsService } from './traffic-events.service';
import { createTrafficObserver } from './traffic-observer.middleware';
import { TrafficEvent } from './traffic-event.interface';

// bcrypt is a native module the guards import transitively; mock it like the
// other guard specs do so the suite runs without the compiled binding.
jest.mock('bcrypt');

// PublicController falls through to the drizzle client when the metadata cache
// misses; keep the test hermetic by answering every query with an empty set.
jest.mock('../db/client', () => {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(() => Promise.resolve([]));
  return { db: chain };
});

/**
 * Seam 1 (issue #389): drive real HTTP requests through the public-content
 * controller with the traffic observer installed, and assert the response
 * policy (serve matched / generic 404 for Unmatched with no path leak) and
 * that every request is observed on the live stream.
 */
describe('Traffic observation at the HTTP boundary', () => {
  let app: INestApplication;
  let events: TrafficEventsService;
  let observed: TrafficEvent[];
  let subscription: { unsubscribe: () => void };

  const project = {
    id: 'p1',
    owner: 'acme',
    name: 'site',
    displayName: 'Site',
    isPublic: true,
    unauthorizedBehavior: 'not_found',
    requiredRole: 'authenticated',
  };

  const indexAsset = {
    id: 'a1',
    projectId: 'p1',
    commitSha: 'abc123',
    publicPath: 'index.html',
    fileName: 'index.html',
    mimeType: 'text/html',
    storageKey: 'acme/site/abc123/index.html',
    contentHash: 'deadbeef',
    fileSize: 18,
  };

  const deploymentsService = { resolveAlias: jest.fn() };
  const projectsService = { getProjectByOwnerName: jest.fn(), getProjectById: jest.fn() };
  const visibilityService = {
    resolveAccessControlByDomain: jest.fn(),
    resolveAccessControlForAlias: jest.fn(),
  };
  const trafficRoutingService = { selectVariant: jest.fn() };
  const permissionsService = { getUserProjectRole: jest.fn(), meetsRoleRequirement: jest.fn() };
  const cacheConfigService = {
    getCacheConfig: jest.fn(),
    buildCacheControlHeader: jest.fn(),
    calculateRedisTtl: jest.fn(),
  };
  const metadataCache = { assetKey: jest.fn(), get: jest.fn(), set: jest.fn() };
  const storageAdapter = { download: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        TrafficEventsService,
        { provide: STORAGE_ADAPTER, useValue: storageAdapter },
        { provide: DeploymentsService, useValue: deploymentsService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: VisibilityService, useValue: visibilityService },
        { provide: TrafficRoutingService, useValue: trafficRoutingService },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CacheConfigService, useValue: cacheConfigService },
        { provide: ShareLinksService, useValue: { validateToken: jest.fn() } },
        {
          provide: ResponseHeaderConfigService,
          useValue: { getHeaderConfig: jest.fn().mockResolvedValue(null) },
        },
        { provide: MetadataCacheService, useValue: metadataCache },
      ],
    })
      .overrideGuard(OptionalAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    events = app.get(TrafficEventsService);
    // Same wiring as main.ts: the observer sits above everything Nest routes.
    app.use(createTrafficObserver(events));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    subscription.unsubscribe();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    observed = [];
    subscription = events.stream().subscribe((e) => observed.push(e));

    deploymentsService.resolveAlias.mockResolvedValue('abc123');
    projectsService.getProjectByOwnerName.mockResolvedValue(project);
    visibilityService.resolveAccessControlForAlias.mockResolvedValue({
      isPublic: true,
      unauthorizedBehavior: 'not_found',
      requiredRole: 'authenticated',
      source: 'alias',
    });
    trafficRoutingService.selectVariant.mockResolvedValue(null);
    cacheConfigService.getCacheConfig.mockResolvedValue({ source: 'default' });
    cacheConfigService.buildCacheControlHeader.mockReturnValue('public, max-age=60');
    cacheConfigService.calculateRedisTtl.mockReturnValue(60);
    metadataCache.assetKey.mockImplementation((...parts: string[]) => parts.join(':'));
    metadataCache.get.mockResolvedValue(null);
    storageAdapter.download.mockResolvedValue(Buffer.from('<html>hello</html>'));
  });

  const waitForEvents = async (count: number): Promise<void> => {
    const deadline = Date.now() + 1000;
    while (observed.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  it('serves a matched request normally and observes it as matched', async () => {
    metadataCache.get.mockResolvedValue(indexAsset);

    const res = await request(app.getHttpServer())
      .get('/public/acme/site/alias/production/index.html')
      .set('X-Forwarded-For', '203.0.113.7')
      .set('User-Agent', 'test-agent');

    expect(res.status).toBe(200);
    expect(res.text).toContain('hello');

    await waitForEvents(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      classification: 'matched',
      status: 200,
      method: 'GET',
      path: '/public/acme/site/alias/production/index.html',
      ip: '203.0.113.7',
      userAgent: 'test-agent',
    });
    expect(observed[0].bytes).toBeGreaterThan(0);
    expect(observed[0].line).toContain(
      '"GET /public/acme/site/alias/production/index.html HTTP/1.1" 200',
    );
  });

  it('answers an Unmatched request with a generic 404 that leaks no paths, and observes it', async () => {
    const res = await request(app.getHttpServer())
      .get('/public/acme/site/alias/production/backend/.env')
      .set('X-Forwarded-For', '198.51.100.9');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    // The friendly page for mistyping users...
    expect(res.text).toContain("The page you're looking for doesn't exist.");
    // ...with no echo of the requested or internal storage path.
    expect(res.text).not.toContain('.env');
    expect(res.text).not.toContain('backend');
    expect(res.text).not.toContain('File not found');
    expect(res.text).not.toContain('sites/');

    await waitForEvents(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      classification: 'unmatched',
      status: 404,
      path: '/public/acme/site/alias/production/backend/.env',
      ip: '198.51.100.9',
    });
  });

  it('returns a generic 404 when the alias itself is unknown, without echoing it', async () => {
    deploymentsService.resolveAlias.mockResolvedValue(null);

    const res = await request(app.getHttpServer()).get(
      '/public/acme/site/alias/no-such-alias/index.html',
    );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('no-such-alias');
    expect(res.text).toContain("The page you're looking for doesn't exist.");

    await waitForEvents(1);
    expect(observed[0].classification).toBe('unmatched');
  });

  it('observes every request in order, live', async () => {
    metadataCache.get.mockResolvedValueOnce(indexAsset);
    await request(app.getHttpServer()).get('/public/acme/site/alias/production/index.html');
    await request(app.getHttpServer()).get('/public/acme/site/alias/production/wp-login.php');

    await waitForEvents(2);
    expect(observed.map((e) => e.classification)).toEqual(['matched', 'unmatched']);
  });
});
