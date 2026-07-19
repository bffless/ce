import { test, expect, Page } from '@playwright/test';
import { mockAllApis } from './fixtures/mobile-viewport-mocks';

/**
 * Mobile viewport regression suite
 *
 * Guards against horizontal overflow at phone width: every admin route must
 * lay out within a 375px viewport (document.scrollWidth === viewport width).
 * This is the regression that shipped when the repo tab bar (7 non-wrapping
 * tabs) forced every /repo/* page out to 641px, project settings to 1168px.
 *
 * The whole /api surface is mocked (see fixtures/mobile-viewport-mocks.ts),
 * so the suite runs without a backend and with deliberately hostile data
 * (long unbroken domains, emails, URLs, alias names).
 *
 * Run with: pnpm test:e2e mobile-viewport
 */

const VIEWPORT = { width: 375, height: 667 };

interface RouteSpec {
  name: string;
  path: string;
  /** Also capture with the dark theme applied */
  dark?: boolean;
}

const ROUTES: RouteSpec[] = [
  { name: 'home', path: '/', dark: true },
  { name: 'repositories list', path: '/repo' },
  { name: 'repo overview', path: '/repo/acme/webapp', dark: true },
  { name: 'repo deployments', path: '/repo/acme/webapp/deployments' },
  { name: 'repo branches', path: '/repo/acme/webapp/branches' },
  { name: 'repo aliases', path: '/repo/acme/webapp/aliases' },
  { name: 'repo proxy rules', path: '/repo/acme/webapp/proxy-rules' },
  { name: 'repo rule set detail', path: '/repo/acme/webapp/proxy-rules/rs-1' },
  { name: 'repo schedules', path: '/repo/acme/webapp/schedules' },
  { name: 'repo data schemas', path: '/repo/acme/webapp/data' },
  { name: 'repo schema detail', path: '/repo/acme/webapp/data/schema-1', dark: true },
  { name: 'repo uploads', path: '/repo/acme/webapp/uploads' },
  { name: 'project settings', path: '/repo/acme/webapp/settings' },
  { name: 'user settings', path: '/settings' },
  { name: 'admin settings', path: '/admin/settings' },
  { name: 'users', path: '/users' },
  { name: 'groups', path: '/groups' },
  { name: 'domains', path: '/domains' },
  { name: 'traffic', path: '/traffic' },
];

async function assertNoHorizontalOverflow(page: Page, path: string, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('app-theme', t);
    } catch {
      /* storage unavailable */
    }
  }, theme);
  await mockAllApis(page);

  await page.goto(path, { waitUntil: 'networkidle' });
  // Give post-load renders (charts, expanding lists) a beat to settle
  await page.waitForTimeout(500);

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(
    widths.scrollWidth,
    `${path} (${theme}) overflows horizontally: document is ${widths.scrollWidth}px in a ${widths.clientWidth}px viewport`,
  ).toBeLessThanOrEqual(widths.clientWidth + 1);
  expect(
    widths.bodyScrollWidth,
    `${path} (${theme}) body overflows horizontally`,
  ).toBeLessThanOrEqual(widths.clientWidth + 1);
}

test.describe('Mobile viewport (375px) has no horizontal overflow', () => {
  test.use({ viewport: VIEWPORT, hasTouch: true });

  for (const route of ROUTES) {
    test(`${route.name} fits the viewport`, async ({ page }) => {
      await assertNoHorizontalOverflow(page, route.path, 'light');
    });

    if (route.dark) {
      test(`${route.name} fits the viewport (dark)`, async ({ page }) => {
        await assertNoHorizontalOverflow(page, route.path, 'dark');
      });
    }
  }
});
