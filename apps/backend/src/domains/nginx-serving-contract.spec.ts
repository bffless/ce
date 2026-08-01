import { readFileSync } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { NginxConfigService } from './nginx-config.service';

/**
 * THE APP-SERVING CONTRACT (ce#598).
 *
 * "How an app served on this instance is proxied" is written independently in
 * seven places — two hand-written envsubst templates, two Handlebars
 * templates, and three TS string-literal generators. Nothing links them, so a
 * fix lands in one copy and the others silently keep the bug. Five defects in
 * one day (#594, #596 x3, #599) were all that shape, and one of them (#596/3)
 * re-broke ce#370, which had been fixed a release earlier in a different copy.
 *
 * None of them was visible to the ~2,700-test suite: they are *reachability*
 * bugs. Every one was diagnosed from live symptoms on a real appliance.
 *
 * This fence asserts the four things every app-serving vhost must get right,
 * against EVERY surface, and names the surface in the test title so a failure
 * says which copy drifted.
 *
 * ORTHOGONALITY (deliberate, do not collapse): these surfaces legitimately
 * differ on SSL termination, listen port and server_name — a platform-style
 * vhost listens on :80 because Traefik/Cloudflare terminates TLS in front of
 * it. That axis is NOT drift and is not asserted here. Only the serving
 * contract is shared.
 */

const REPO_ROOT = path.join(__dirname, '../../../..');
const TEMPLATE_DIR = path.join(__dirname, '../../templates/nginx');

// ---------------------------------------------------------------------------
// A very small nginx reader: enough to tell "declared at server level" from
// "declared inside a location", which is the whole point of the body-size and
// buffer assertions below.
// ---------------------------------------------------------------------------

const stripComments = (text: string): string => text.replace(/#[^\n]*/g, '');

/** Body of the brace-delimited block whose opening `{` is at `openBraceIndex`. */
function blockBodyAt(text: string, openBraceIndex: number): string {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(openBraceIndex + 1, i - 1);
}

/** Every `server { ... }` body in a config. */
function serverBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /\bserver\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const body = blockBodyAt(text, open);
    blocks.push(body);
    re.lastIndex = open + body.length + 2;
  }
  return blocks;
}

/** The same body with every nested `{ ... }` removed — i.e. server scope only. */
function withoutNestedBlocks(body: string): string {
  let out = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/** Body of the first `location <pattern> { ... }` matching `header`. */
function locationBody(scope: string, header: RegExp): string | null {
  const match = header.exec(scope);
  if (!match) return null;
  const open = scope.indexOf('{', match.index);
  if (open === -1) return null;
  return blockBodyAt(scope, open);
}

/** Value of a single-valued directive declared in this scope, or null. */
function directive(scope: string, name: string): string | null {
  const match = new RegExp(`(?:^|[\\n;])\\s*${name}\\s+([^;]+);`).exec(scope);
  return match ? match[1].trim() : null;
}

/** nginx size suffixes: bare bytes, `k`, `m`, `g`. */
function parseSize(raw: string): number {
  const match = /^(\d+)\s*([kKmMgG]?)$/.exec(raw.trim());
  if (!match) throw new Error(`unparseable nginx size: "${raw}"`);
  const scale: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

/** `proxy_buffers 8 16k` -> the per-buffer size. */
const parseProxyBuffers = (raw: string): number => parseSize(raw.trim().split(/\s+/)[1]);

/** Directives at the http level of a real nginx.conf, which server blocks inherit. */
function httpLevelDirectives(file: string): string {
  const text = stripComments(readFileSync(file, 'utf-8'));
  const match = /\bhttp\s*\{/.exec(text);
  if (!match) throw new Error(`no http block in ${file}`);
  return withoutNestedBlocks(blockBodyAt(text, match.index + match[0].length - 1));
}

// ---------------------------------------------------------------------------
// Inherited http-level context.
//
// A server block only needs to declare a directive itself if nothing above it
// does. Which http block a surface lands under is a property OF THE SURFACE,
// so it is declared per surface rather than assumed:
//
//   DOCKER_HTTP — shipped in the same image as the surface
//                 (docker/nginx/nginx.conf), so the inheritance is real, and
//                 it is read from the actual file rather than hardcoded: drop
//                 the http-level value and the dependent surfaces go red.
//   STOCK_NGINX — the surface is a conf.d fragment or a sites-enabled file
//                 written into someone else's nginx (Umbrel, a platform
//                 workspace). Nothing is inherited, so nginx's own defaults
//                 apply: client_max_body_size 1m, proxy_buffer_size 4k. That
//                 is exactly how #596 shipped a 413 and a 502.
// ---------------------------------------------------------------------------

const DOCKER_HTTP = () => httpLevelDirectives(path.join(REPO_ROOT, 'docker/nginx/nginx.conf'));
const STOCK_NGINX = () => '';

/** nginx's compiled-in defaults, which are wrong for every surface here. */
const NGINX_DEFAULT_MAX_BODY = 1024 * 1024; // 1m
const MIN_PROXY_BUFFER = 16 * 1024; // ce#370: the 4k default 502s on session refresh

// ---------------------------------------------------------------------------
// Rendering the hand-written envsubst templates.
// ---------------------------------------------------------------------------

/** The variables render-main-conf.sh passes to envsubst, in its open-port-80 branch. */
const ENVSUBST_VARS: Record<string, string> = {
  PRIMARY_DOMAIN: 'example.com',
  WILDCARD_CERT: '/etc/nginx/ssl/wildcard.example.com.crt',
  WILDCARD_KEY: '/etc/nginx/ssl/wildcard.example.com.key',
  PRIMARY_CERT: '/etc/nginx/ssl/live/example.com/fullchain.pem',
  PRIMARY_KEY: '/etc/nginx/ssl/live/example.com/privkey.pem',
  PORT80_ACTION: 'return 301 https://$host$request_uri;',
  ACME_LOCATION: 'location /.well-known/acme-challenge/ { root /var/www/certbot; }',
};

/** `$host` / `$subdomain` are `$name`, not `${name}`, so they survive untouched. */
const envsubst = (text: string): string =>
  text.replace(/\$\{(\w+)\}/g, (whole, name: string) => ENVSUBST_VARS[name] ?? whole);

const readTemplate = (relPath: string): string =>
  envsubst(readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'));

const renderHbs = (file: string, ctx: Record<string, unknown>): string =>
  Handlebars.compile(readFileSync(path.join(TEMPLATE_DIR, file), 'utf-8'))(ctx);

const HBS_CONTEXT = {
  domain: 'handoff.example.com',
  id: 'mapping-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  listenPort: 80,
  backendHost: 'backend',
  backendPort: 3000,
  alias: 'handoff',
  path: '',
  project: { owner: 'acme', name: 'handoff' },
  sslCertPath: '/etc/nginx/ssl/wildcard.example.com.crt',
  sslCertKeyPath: '/etc/nginx/ssl/wildcard.example.com.key',
  blocklistRules: '',
  isSpa: true,
};

// ---------------------------------------------------------------------------
// Driving the TS generators through their real public entry point.
// ---------------------------------------------------------------------------

/**
 * `cloudflare-tunnel` is the Umbrel shape: it makes isExternalSslProxy() true,
 * which routes generateConfig() to the platform-style generators. `none`
 * leaves nginx handling SSL, which routes to the CE templates and the CE
 * primary generator. Both paths serve apps, so both are fenced.
 */
function buildService(proxyMode: string): NginxConfigService {
  const featureFlags = { isEnabled: jest.fn().mockResolvedValue(false) };
  const edgeBlocklist = { getServerRules: jest.fn().mockReturnValue(''), sync: jest.fn() };
  const configService = {
    get: jest.fn((key: string, fallback?: string) => ({ PROXY_MODE: proxyMode })[key] ?? fallback),
  };
  return new NginxConfigService(
    featureFlags as never,
    configService as never,
    edgeBlocklist as never,
  );
}

const BASE_MAPPING = {
  id: 'dom-1',
  domain: 'handoff.example.com',
  domainType: 'subdomain',
  alias: 'handoff',
  path: '/apps/handoff/dist',
  isSpa: true,
  sslEnabled: false,
  createdAt: new Date('2026-08-01T00:00:00Z'),
};

const PROJECT = { owner: 'bffless', name: 'handoff' } as never;

const generate = (proxyMode: string, overrides: Record<string, unknown>): Promise<string> =>
  buildService(proxyMode).generateConfig({ ...BASE_MAPPING, ...overrides } as never, PROJECT);

// ---------------------------------------------------------------------------
// The surfaces.
// ---------------------------------------------------------------------------

interface Surface {
  /** Named in the test title, so a failure says which copy drifted. */
  name: string;
  /** Fully-rendered nginx config text for this surface. */
  render: () => string | Promise<string>;
  /** http-level directives this surface's server blocks inherit. */
  inherits: () => string;
}

const SURFACES: Surface[] = [
  {
    name: 'docker/nginx/sites-available/main.conf.template (compose: *.<primary> wildcard)',
    render: () => readTemplate('docker/nginx/sites-available/main.conf.template'),
    inherits: DOCKER_HTTP,
  },
  {
    // Rendered into conf.d/ of a stock nginx image — it inherits nothing.
    name: 'umbrel/nginx.conf.template (Umbrel: *.<primary> wildcard)',
    render: () => readTemplate('umbrel/nginx.conf.template'),
    inherits: STOCK_NGINX,
  },
  {
    name: 'templates/nginx/subdomain.conf.hbs (sslEnabled)',
    render: () => renderHbs('subdomain.conf.hbs', { ...HBS_CONTEXT, sslEnabled: true }),
    inherits: DOCKER_HTTP,
  },
  {
    name: 'templates/nginx/subdomain.conf.hbs (http-only)',
    render: () => renderHbs('subdomain.conf.hbs', { ...HBS_CONTEXT, sslEnabled: false }),
    inherits: DOCKER_HTTP,
  },
  {
    name: 'templates/nginx/custom-domain.conf.hbs (sslEnabled)',
    render: () => renderHbs('custom-domain.conf.hbs', { ...HBS_CONTEXT, sslEnabled: true }),
    inherits: DOCKER_HTTP,
  },
  {
    name: 'templates/nginx/custom-domain.conf.hbs (http-only)',
    render: () => renderHbs('custom-domain.conf.hbs', { ...HBS_CONTEXT, sslEnabled: false }),
    inherits: DOCKER_HTTP,
  },
  {
    name: 'nginx-config.service.ts generatePlatformSubdomainConfig',
    render: () => generate('cloudflare-tunnel', { domainType: 'subdomain' }),
    inherits: STOCK_NGINX,
  },
  {
    name: 'nginx-config.service.ts generatePlatformCustomDomainConfig',
    render: () =>
      generate('cloudflare-tunnel', { domainType: 'custom', domain: 'files.example.com' }),
    inherits: STOCK_NGINX,
  },
  {
    name: 'nginx-config.service.ts generatePlatformPrimaryDomainConfig',
    render: () =>
      generate('cloudflare-tunnel', {
        isPrimary: true,
        domain: 'example.com',
        wwwBehavior: 'serve-both',
      }),
    inherits: STOCK_NGINX,
  },
  {
    // Not listed in ce#598, found while writing this fence: the CE primary
    // generator is a seventh app-serving surface, with its own hand-inlined
    // copy of the presigned location rather than the shared helper.
    name: 'nginx-config.service.ts generateCEPrimaryDomainConfig',
    render: () =>
      generate('none', { isPrimary: true, domain: 'example.com', wwwBehavior: 'serve-both' }),
    inherits: DOCKER_HTTP,
  },
];

// ---------------------------------------------------------------------------
// Selecting the vhosts this contract applies to.
// ---------------------------------------------------------------------------

/**
 * An app-serving vhost is one that rewrites the request path into the
 * backend's /public/ content handler. That excludes the admin vhost (it
 * proxies /public without rewriting), redirect vhosts, ACME-only vhosts and
 * the Umbrel setup page — none of which serve app content.
 */
const SERVES_APP_CONTENT = /rewrite\s+\^\/\(\.\*\)\$\s+\/public\//;

const appServingBlocks = (config: string): string[] =>
  serverBlocks(stripComments(config)).filter((block) => SERVES_APP_CONTENT.test(block));

// ---------------------------------------------------------------------------

describe.each(SURFACES.map((surface) => [surface.name, surface] as const))(
  'app-serving contract: %s',
  (_name, surface) => {
    let blocks: string[];
    let inherited: string;

    beforeAll(async () => {
      blocks = appServingBlocks(await surface.render());
      inherited = surface.inherits();
    });

    // Guards the rest of the suite: a selector that silently matched nothing
    // would make every assertion below vacuously true.
    it('declares at least one app-serving vhost', () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    it('reaches the cross-domain auth relay unrewritten', () => {
      // Apps served on their own hostname sign in through /_bffless/auth/.
      // Without an explicit location the catch-all rewrites it into the
      // content handler and every login 404s (#594).
      for (const block of blocks) {
        expect(block).toContain('location /_bffless/auth/');
      }
    });

    it('reaches the local presigned upload route unrewritten, as an EXACT match', () => {
      // Presigned local-filesystem uploads AND their signed GET downloads
      // share this route. `location =` is load-bearing: nginx always prefers
      // an exact match over a prefix match, so it beats the catch-all
      // regardless of declaration order (#594, #596/1).
      for (const block of blocks) {
        expect(block).toContain('location = /api/storage/presigned/local');
        expect(block).not.toMatch(/location\s+\/api\/storage\/presigned\/local\s*\{/);
      }
    });

    it("raises client_max_body_size above nginx's 1M default", () => {
      // Server level, or inherited from an http block shipped alongside this
      // surface. Deliberately NOT the 200M inside the presigned location:
      // that ceiling covers one route, while this is the floor for every
      // other proxied path, and its absence 413'd pipeline uploads and form
      // posts on externally-proxied installs (#596/2).
      for (const block of blocks) {
        const scope = withoutNestedBlocks(block);
        const value =
          directive(scope, 'client_max_body_size') ?? directive(inherited, 'client_max_body_size');

        expect(value).not.toBeNull();
        expect(parseSize(value as string)).toBeGreaterThan(NGINX_DEFAULT_MAX_BODY);
      }
    });

    it('sizes proxy header buffers so a SuperTokens session refresh does not 502', () => {
      // ce#370. A successful /api/auth/session/refresh returns rotated
      // sAccessToken + sRefreshToken JWTs plus front-token and anti-csrf; at
      // nginx's 4k default that overflows the header buffer and nginx answers
      // 502 "upstream sent too big header". Resolved where the response
      // actually flows: the catch-all location, then server, then http.
      for (const block of blocks) {
        const serverScope = withoutNestedBlocks(block);
        const catchAll = locationBody(block, /location\s+\/\s*\{/) ?? '';

        const bufferSize =
          directive(catchAll, 'proxy_buffer_size') ??
          directive(serverScope, 'proxy_buffer_size') ??
          directive(inherited, 'proxy_buffer_size');
        const buffers =
          directive(catchAll, 'proxy_buffers') ??
          directive(serverScope, 'proxy_buffers') ??
          directive(inherited, 'proxy_buffers');

        expect(bufferSize).not.toBeNull();
        expect(parseSize(bufferSize as string)).toBeGreaterThanOrEqual(MIN_PROXY_BUFFER);

        // proxy_buffer_size alone only covers the response's first buffer; the
        // rest of the headers spill into proxy_buffers, so they must match.
        expect(buffers).not.toBeNull();
        expect(parseProxyBuffers(buffers as string)).toBeGreaterThanOrEqual(MIN_PROXY_BUFFER);
      }
    });
  },
);

describe('the fence itself', () => {
  // If a rename or refactor stops a surface from being recognised, the suite
  // above goes quietly green. This pins the roster.
  it('covers every known app-serving surface', () => {
    expect(SURFACES).toHaveLength(10);
  });

  it('does not treat non-app-serving vhosts as app-serving', () => {
    const mainConf = readTemplate('docker/nginx/sites-available/main.conf.template');
    const all = serverBlocks(stripComments(mainConf));
    const serving = appServingBlocks(mainConf);

    // main.conf.template declares three: the port-80 catch-all, the wildcard
    // app vhost, and the admin panel. Only the wildcard serves app content.
    expect(all.length).toBeGreaterThan(serving.length);
    expect(serving).toHaveLength(1);
    expect(serving[0]).toContain('/public/subdomain-alias/');
  });

  it('still rewrites everything else into the subdomain-alias handler', () => {
    // The wildcard vhosts' whole job. If this stops matching, the selector
    // above is measuring something other than app serving.
    for (const relPath of [
      'docker/nginx/sites-available/main.conf.template',
      'umbrel/nginx.conf.template',
    ]) {
      expect(appServingBlocks(readTemplate(relPath))[0]).toContain('/public/subdomain-alias/');
    }
  });
});
