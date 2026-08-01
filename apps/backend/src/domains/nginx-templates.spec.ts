import { promises as fs } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

/**
 * Renders the REAL shipped nginx templates.
 *
 * `nginx-config.service.spec.ts` stubs `fs.readFile` with tiny inline
 * fixtures, so nothing in that suite can see what the shipped `.hbs` files
 * actually contain. That blind spot is how ce#584 shipped: the subdomain
 * template had no ACME challenge location, so an app installed at
 * `<app>.<primary>` on a direct-serving instance answered
 * `/.well-known/acme-challenge/*` with the app's SPA fallback instead of the
 * challenge file — making HTTP-01 issuance (and renewal) impossible for that
 * host, while every unit test passed.
 */
const TEMPLATE_DIR = path.join(__dirname, '../../templates/nginx');

async function render(file: string, ctx: Record<string, unknown>): Promise<string> {
  const raw = await fs.readFile(path.join(TEMPLATE_DIR, file), 'utf-8');
  return Handlebars.compile(raw)(ctx);
}

const baseCtx = {
  domain: 'handoff.example.com',
  id: 'mapping-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  listenPort: 80,
  backendHost: 'backend',
  backendPort: 3000,
  alias: 'handoff',
  project: { owner: 'acme', name: 'handoff' },
  sslCertPath: '/etc/nginx/ssl/wildcard.example.com.crt',
  sslCertKeyPath: '/etc/nginx/ssl/wildcard.example.com.key',
  blocklistRules: '',
  isSpa: true,
};

/** nginx serves the challenge from the certbot webroot — the exact pairing
 *  `render-main-conf.sh` emits for the primary server block. */
function expectAcmeLocation(config: string): void {
  expect(config).toContain('location /.well-known/acme-challenge/');
  expect(config).toMatch(/location \/\.well-known\/acme-challenge\/ \{\s*root \/var\/www\/certbot;/);
}

describe('shipped nginx templates: ACME challenge reachability', () => {
  describe.each([
    ['subdomain.conf.hbs'],
    ['custom-domain.conf.hbs'],
  ])('%s', (template) => {
    it('serves the ACME challenge on the HTTP server block when SSL is off', async () => {
      const config = await render(template, { ...baseCtx, sslEnabled: false });
      expectAcmeLocation(config);
    });

    it('serves the ACME challenge on the HTTP block when SSL is on (renewal path)', async () => {
      const config = await render(template, { ...baseCtx, sslEnabled: true });
      expectAcmeLocation(config);
    });
  });

  it('keeps the ACME location ahead of the HTTPS redirect, so the challenge is not 301d away', async () => {
    const config = await render('subdomain.conf.hbs', { ...baseCtx, sslEnabled: true });
    const acmeAt = config.indexOf('location /.well-known/acme-challenge/');
    const redirectAt = config.indexOf('return 301 https://$host$request_uri');
    expect(acmeAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(-1);
    expect(acmeAt).toBeLessThan(redirectAt);
  });

  it('still serves app content from the catch-all location (ACME must not shadow the app)', async () => {
    const config = await render('subdomain.conf.hbs', { ...baseCtx, sslEnabled: false });
    expect(config).toContain('/public/acme/handoff/alias/handoff');
  });
});
