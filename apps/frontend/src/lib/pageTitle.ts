/**
 * Route-driven document titles for the admin panel.
 *
 * Every admin URL maps to a list of title parts, most specific first. The parts
 * are joined with the site name (which is brandable, see `useBranding`) to form
 * the final `document.title`:
 *
 *   ['Deployments', 'acme/site'] + 'BFFLESS'
 *     -> 'Deployments · acme/site · BFFLESS'
 *
 * Pages that can render a *better* title once their data loads (a rule set's
 * name, a schema's name, ...) override the route-derived title with the
 * `useDocumentTitle` hook — see `@/components/DocumentTitle`.
 */
import { matchPath } from 'react-router-dom';

export const TITLE_SEPARATOR = ' · ';

type RouteParams = Record<string, string | undefined>;

type TitleResolver = (params: RouteParams, search: URLSearchParams) => string[];

interface RouteTitle {
  /** React Router path pattern, matched with `matchPath`. */
  pattern: string;
  /** Static parts, or a resolver when the title depends on params/query. */
  title: string | string[] | TitleResolver;
}

/** `owner/repo`, the label used for a project throughout the UI. */
const project = (params: RouteParams): string => `${params.owner}/${params.repo}`;

/** Tab labels for `/settings?tab=...` (UserSettingsPage). */
const USER_SETTINGS_TABS: Record<string, string> = {
  profile: 'Profile',
  sites: 'My Sites',
  'api-keys': 'API Keys',
  preferences: 'Preferences',
};

/**
 * Ordered most-specific first. Unlike React Router — which ranks routes by
 * specificity — this list is matched top-down, so patterns with static segments
 * (`.../deployments`) MUST be listed before the dynamic patterns that would also
 * match them (`.../:ref`).
 */
const ROUTE_TITLES: RouteTitle[] = [
  // Home is the site itself — no prefix, just the branded name.
  { pattern: '/', title: [] },

  // Pre-auth / auth flows
  { pattern: '/setup', title: 'Setup' },
  { pattern: '/login', title: 'Sign in' },
  { pattern: '/logout', title: 'Signed out' },
  { pattern: '/signup', title: 'Sign up' },
  { pattern: '/forgot-password', title: 'Forgot password' },
  { pattern: '/reset-password', title: 'Reset password' },
  { pattern: '/verify-email', title: 'Verify email' },
  { pattern: '/invite/:token', title: 'Accept invitation' },
  { pattern: '/oauth/signin/callback', title: 'Signing in' },
  { pattern: '/oauth/callback', title: 'Authorizing' },

  // User settings (tabs live in the `tab` query param)
  {
    pattern: '/settings',
    title: (_params, search) => [
      USER_SETTINGS_TABS[search.get('tab') ?? ''] ?? USER_SETTINGS_TABS.profile,
      'Settings',
    ],
  },
  { pattern: '/account', title: 'Account' },

  // Admin settings (tabs are nested routes)
  { pattern: '/admin/settings', title: ['General', 'Admin settings'] },
  { pattern: '/admin/settings/auth', title: ['Authentication', 'Admin settings'] },
  { pattern: '/admin/settings/email', title: ['Email', 'Admin settings'] },
  { pattern: '/admin/settings/infrastructure', title: ['Infrastructure', 'Admin settings'] },
  { pattern: '/admin/settings/ssl', title: ['SSL', 'Admin settings'] },

  // Repositories
  { pattern: '/repo', title: 'Repositories' },
  { pattern: '/repo/:owner/:repo/settings', title: (p) => ['Settings', project(p)] },
  { pattern: '/repo/:owner/:repo/deployments', title: (p) => ['Deployments', project(p)] },
  { pattern: '/repo/:owner/:repo/branches', title: (p) => ['Branches', project(p)] },
  { pattern: '/repo/:owner/:repo/aliases', title: (p) => ['Aliases', project(p)] },
  {
    pattern: '/repo/:owner/:repo/proxy-rules/:ruleSetId/new',
    title: (p) => ['New rule', 'Proxy Rules', project(p)],
  },
  {
    pattern: '/repo/:owner/:repo/proxy-rules/:ruleSetId/:ruleId/logs',
    title: (p) => ['Logs', 'Proxy Rules', project(p)],
  },
  {
    pattern: '/repo/:owner/:repo/proxy-rules/:ruleSetId/:ruleId',
    title: (p) => ['Rule', 'Proxy Rules', project(p)],
  },
  {
    pattern: '/repo/:owner/:repo/proxy-rules/:ruleSetId',
    title: (p) => ['Rule set', 'Proxy Rules', project(p)],
  },
  { pattern: '/repo/:owner/:repo/proxy-rules', title: (p) => ['Proxy Rules', project(p)] },
  { pattern: '/repo/:owner/:repo/schedules', title: (p) => ['Schedules', project(p)] },
  { pattern: '/repo/:owner/:repo/data/new', title: (p) => ['New schema', 'Data', project(p)] },
  {
    pattern: '/repo/:owner/:repo/data/:schemaId/edit',
    title: (p) => ['Edit schema', 'Data', project(p)],
  },
  { pattern: '/repo/:owner/:repo/data/:schemaId', title: (p) => ['Schema', 'Data', project(p)] },
  { pattern: '/repo/:owner/:repo/data', title: (p) => ['Data', project(p)] },
  {
    pattern: '/repo/:owner/:repo/uploads/:schemaId',
    title: (p) => ['Schema', 'Uploads', project(p)],
  },
  { pattern: '/repo/:owner/:repo/uploads', title: (p) => ['Uploads', project(p)] },

  // File browser — must come after every static repo tab above.
  { pattern: '/repo/:owner/:repo/:ref/*', title: (p) => [p['*'] || 'Files', project(p)] },
  { pattern: '/repo/:owner/:repo/:ref', title: (p) => ['Files', project(p)] },
  { pattern: '/repo/:owner/:repo', title: (p) => [project(p)] },

  // Admin-only sections
  { pattern: '/groups/:groupId', title: ['Group', 'User groups'] },
  { pattern: '/groups', title: 'User groups' },
  { pattern: '/users', title: 'Users' },
  { pattern: '/domains', title: 'Domains' },
  { pattern: '/traffic', title: 'Traffic' },
];

/**
 * Title parts for a pathname, most specific first. Returns `[]` for the home
 * route and for URLs with no mapping (so the branded site name stands alone).
 */
export function getRouteTitleParts(pathname: string, search?: URLSearchParams): string[] {
  const searchParams = search ?? new URLSearchParams();

  for (const { pattern, title } of ROUTE_TITLES) {
    const match = matchPath(pattern, pathname);
    if (!match) continue;

    const parts = typeof title === 'function' ? title(match.params, searchParams) : title;
    return (Array.isArray(parts) ? parts : [parts]).filter(Boolean);
  }

  return [];
}

/** Joins title parts with the (brandable) site name. */
export function formatDocumentTitle(parts: string[], siteName: string): string {
  return [...parts.filter(Boolean), siteName].join(TITLE_SEPARATOR);
}
