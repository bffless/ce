import { Page } from '@playwright/test';
import {
  mockRepoRefs,
  mockFileTree,
  mockFileContents,
  mockDeployments,
  mockRepoStats,
  mockSidebarRepositories,
  mockRepositoryFeed,
  mockEmptyRepositoryFeed
} from '../fixtures/mock-data';

/**
 * Sets up API mocking for repository overview page tests
 */
export async function mockRepositoryOverviewAPI(page: Page, owner: string, repo: string) {
  // Mock the repository stats endpoint
  await page.route(`**/api/repo/${owner}/${repo}/stats`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockRepoStats),
    });
  });

  // Mock the deployments list endpoint
  await page.route(`**/api/repo/${owner}/${repo}/deployments*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockDeployments),
    });
  });

  // Mock the refs endpoint (for branch filter)
  await page.route(`**/api/repo/${owner}/${repo}/refs`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockRepoRefs),
    });
  });

  // Mock the aliases endpoint
  await page.route(`**/api/repo/${owner}/${repo}/aliases`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        repository: `${owner}/${repo}`,
        aliases: [
          {
            id: 'alias-1',
            name: 'production',
            commitSha: 'abc123def456789',
            shortSha: 'abc123d',
            branch: 'main',
            createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
            updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          }
        ]
      }),
    });
  });

  // Also set up repository browser mocks for navigation
  await mockRepositoryAPI(page, owner, repo);
}

/**
 * Mock a 404 error for repository overview
 */
export async function mockRepositoryOverviewNotFound(page: Page, owner: string, repo: string) {
  await page.route(`**/api/repo/${owner}/${repo}/stats`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Repository not found',
        message: `Repository ${owner}/${repo} does not exist`,
      }),
    });
  });

  await page.route(`**/api/repo/${owner}/${repo}/deployments*`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Repository not found',
      }),
    });
  });
}

/**
 * Mock a network error for repository overview
 */
export async function mockRepositoryOverviewError(page: Page, owner: string, repo: string) {
  await page.route(`**/api/repo/${owner}/${repo}/**`, async (route) => {
    await route.abort('failed');
  });
}

/**
 * Mock an empty repository (no deployments)
 */
export async function mockEmptyRepository(page: Page, owner: string, repo: string) {
  await page.route(`**/api/repo/${owner}/${repo}/stats`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        repository: `${owner}/${repo}`,
        totalDeployments: 0,
        totalStorageBytes: 0,
        totalStorageMB: 0,
        lastDeployedAt: null,
        branchCount: 0,
        aliasCount: 0,
        isPublic: true,
      }),
    });
  });

  await page.route(`**/api/repo/${owner}/${repo}/deployments*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        repository: `${owner}/${repo}`,
        page: 1,
        limit: 20,
        total: 0,
        deployments: [],
      }),
    });
  });

  await page.route(`**/api/repo/${owner}/${repo}/refs`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        repository: `${owner}/${repo}`,
        refs: [],
      }),
    });
  });
}

/**
 * Sets up API mocking for repository browser tests
 */
export async function mockRepositoryAPI(page: Page, owner: string, repo: string) {
  // Mock the repository refs endpoint (with optional query params)
  await page.route(`**/api/repo/${owner}/${repo}/refs*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockRepoRefs),
    });
  });

  // Mock the file tree endpoint for the main commit
  await page.route(`**/api/repo/${owner}/${repo}/*/files`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockFileTree),
    });
  });

  // Mock file content requests
  await page.route(`**/public/${owner}/${repo}/**/*`, async (route) => {
    const url = route.request().url();

    // Extract the file path from the URL
    const urlPattern = new RegExp(`/public/${owner}/${repo}/[^/]+/(.+)$`);
    const match = url.match(urlPattern);

    if (!match) {
      await route.fulfill({
        status: 404,
        body: 'Not Found',
      });
      return;
    }

    const filePath = match[1];
    const content = mockFileContents[filePath];

    if (content) {
      // Determine content type based on file extension
      const contentType = getContentType(filePath);

      await route.fulfill({
        status: 200,
        contentType,
        body: content,
      });
    } else if (filePath.endsWith('.png') || filePath.endsWith('.jpg')) {
      // Mock image files with a small 1x1 PNG
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await route.fulfill({
        status: 200,
        contentType: filePath.endsWith('.png') ? 'image/png' : 'image/jpeg',
        body: Buffer.from(base64Image, 'base64'),
      });
    } else {
      await route.fulfill({
        status: 404,
        body: 'Not Found',
      });
    }
  });
}

/**
 * Mock a 404 error for non-existent repository
 */
export async function mockRepositoryNotFound(page: Page, owner: string, repo: string) {
  await page.route(`**/api/repo/${owner}/${repo}/refs`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Repository not found',
        message: `Repository ${owner}/${repo} does not exist`,
      }),
    });
  });

  await page.route(`**/api/repo/${owner}/${repo}/*/files`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Repository not found',
      }),
    });
  });
}

/**
 * Mock a network error for testing error handling
 */
export async function mockNetworkError(page: Page, owner: string, repo: string) {
  await page.route(`**/api/repo/${owner}/${repo}/**`, async (route) => {
    await route.abort('failed');
  });
}

/**
 * Get content type based on file extension
 */
function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();

  const contentTypes: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    tsx: 'application/typescript',
    json: 'application/json',
    md: 'text/markdown',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };

  return contentTypes[ext || ''] || 'text/plain';
}

/**
 * Sets up API mocking for repository list page tests
 */
export async function mockRepositoryListAPI(page: Page) {
  // Mock the sidebar repositories endpoint
  await page.route('**/api/repositories/mine', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockSidebarRepositories),
    });
  });

  // Mock the repository feed endpoint
  await page.route('**/api/repositories/feed*', async (route) => {
    const url = route.request().url();
    const searchParams = new URL(url).searchParams;
    const search = searchParams.get('search');

    // If searching, filter repositories
    if (search) {
      const query = search.toLowerCase();
      const filtered = mockRepositoryFeed.repositories.filter(
        (repo) =>
          repo.name.toLowerCase().includes(query) ||
          repo.owner.toLowerCase().includes(query) ||
          repo.description?.toLowerCase().includes(query)
      );

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockRepositoryFeed,
          total: filtered.length,
          repositories: filtered,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockRepositoryFeed),
      });
    }
  });
}

/**
 * Mock empty repository list (no repositories)
 */
export async function mockEmptyRepositoryList(page: Page) {
  await page.route('**/api/repositories/mine', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 0, repositories: [] }),
    });
  });

  await page.route('**/api/repositories/feed*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockEmptyRepositoryFeed),
    });
  });
}

/**
 * Mock repository list API error
 */
export async function mockRepositoryListError(page: Page) {
  await page.route('**/api/repositories/**', async (route) => {
    await route.abort('failed');
  });
}
