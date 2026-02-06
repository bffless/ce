import { Page } from '@playwright/test';

/**
 * Test user data for E2E tests
 */
export const TEST_USER = {
  id: 'test-user-123',
  email: 'test@example.com',
  role: 'user' as const,
};

export const TEST_ADMIN_USER = {
  id: 'test-admin-456',
  email: 'admin@example.com',
  role: 'admin' as const,
};

/**
 * Mock session info response structure
 */
export interface MockSessionInfo {
  session: {
    userId: string;
    handle: string;
  };
  user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
  } | null;
}

/**
 * Create a mock authenticated session for a test user
 */
export function createMockSession(
  user: typeof TEST_USER | typeof TEST_ADMIN_USER = TEST_USER
): MockSessionInfo {
  return {
    session: {
      userId: user.id,
      handle: `session-handle-${user.id}`,
    },
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}

/**
 * Create a mock unauthenticated session
 */
export function createUnauthenticatedSession(): MockSessionInfo {
  return {
    session: {
      userId: '',
      handle: '',
    },
    user: null,
  };
}

/**
 * Set up authentication mocking for a test user
 *
 * This function:
 * 1. Sets SuperTokens session cookies (sAccessToken, sRefreshToken)
 * 2. Mocks the /api/auth/session endpoint to return user data
 * 3. Mocks the /api/auth/session/refresh endpoint for token refresh
 *
 * @param page - Playwright page object
 * @param user - User to authenticate as (defaults to TEST_USER)
 */
export async function mockAuthSession(
  page: Page,
  user: typeof TEST_USER | typeof TEST_ADMIN_USER = TEST_USER
) {
  // Set SuperTokens session cookies
  // These are HTTP-only cookies that SuperTokens uses for session management
  await page.context().addCookies([
    {
      name: 'sAccessToken',
      value: `mock-access-token-${user.id}`,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'sRefreshToken',
      value: `mock-refresh-token-${user.id}`,
      domain: 'localhost',
      path: '/auth',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  // Mock the session verification endpoint
  // This is called by useGetSessionQuery() to check if user is authenticated
  await page.route('**/api/auth/session', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      // Return authenticated session info
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockSession(user)),
      });
    } else {
      // Allow other methods through
      await route.continue();
    }
  });

  // Mock the session refresh endpoint
  // This is called when access token expires
  await page.route('**/api/auth/session/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'OK',
      }),
    });
  });
}

/**
 * Set up unauthenticated session mocking
 *
 * This function mocks an unauthenticated state where user is null
 * but no redirect to login occurs (useful for testing optional auth)
 *
 * @param page - Playwright page object
 */
export async function mockUnauthenticatedSession(page: Page) {
  // Mock the session endpoint to return unauthenticated state
  await page.route('**/api/auth/session', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createUnauthenticatedSession()),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock authentication as an admin user
 *
 * @param page - Playwright page object
 */
export async function mockAdminSession(page: Page) {
  await mockAuthSession(page, TEST_ADMIN_USER);
}

/**
 * Clear all authentication (remove cookies and stop mocking)
 *
 * @param page - Playwright page object
 */
export async function clearAuth(page: Page) {
  // Clear session cookies
  await page.context().clearCookies();

  // Stop mocking session endpoints
  await page.unroute('**/api/auth/session');
  await page.unroute('**/api/auth/session/refresh');
}
