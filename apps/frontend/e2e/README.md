# E2E Testing with Playwright

This directory contains end-to-end tests for the frontend application using Playwright.

## Setup

All tests use **mocked API responses** and do not require a backend server or database. The mocking is handled automatically by the test helpers.

## Running Tests

```bash
# Run all tests (all 5 browsers = 90 tests)
pnpm playwright test

# Run tests in UI mode (interactive)
pnpm playwright test --ui

# Run tests in headed mode (see browser)
pnpm playwright test --headed

# Run specific test file
pnpm playwright test repository-browser.spec.ts

# Run tests for specific browser
pnpm playwright test --project=chromium
pnpm playwright test --project=firefox
pnpm playwright test --project=webkit
pnpm playwright test --project="Mobile Chrome"
pnpm playwright test --project="Mobile Safari"
```

**Note:** CI only runs Chromium tests (18 tests) for speed. Locally, all 5 browsers are available (90 tests total).

## Test Structure

### Test Files

- `repository-browser.spec.ts` - Tests for the repository browser feature (Phase 2)
- `repository-overview.spec.ts` - Tests for the repository overview page (Section 2K)

### Helper Files

- `helpers/mock-api.ts` - API mocking utilities
  - `mockRepositoryAPI()` - Mocks all repository browser endpoints
  - `mockRepositoryOverviewAPI()` - Mocks repository overview endpoints (stats, deployments, aliases)
  - `mockRepositoryNotFound()` - Mocks 404 responses for file browser
  - `mockRepositoryOverviewNotFound()` - Mocks 404 responses for overview
  - `mockRepositoryOverviewError()` - Mocks network errors for overview
  - `mockEmptyRepository()` - Mocks empty repository state
  - `mockNetworkError()` - Mocks network failures

### Fixtures

- `fixtures/mock-data.ts` - Mock data for all API responses
  - `mockRepoStats` - Repository statistics (deployments, storage, branches, aliases)
  - `mockDeployments` - Deployments list with pagination data
  - `mockRepoRefs` - Repository branches, aliases, and commits
  - `mockFileTree` - File tree structure
  - `mockFileContents` - File content for various file types

## How API Mocking Works

The tests use Playwright's `page.route()` to intercept network requests and return mock data:

```typescript
test.beforeEach(async ({ page }) => {
  // Set up API mocking
  await mockRepositoryAPI(page, 'testuser', 'test-repo');

  // Navigate to page
  await page.goto('/repo/testuser/test-repo/main');
});
```

### Mocked Endpoints

**Repository Browser:**
1. **GET /api/repo/{owner}/{repo}/refs**
   - Returns: branches, aliases, and recent commits

2. **GET /api/repo/{owner}/{repo}/{commitSha}/files**
   - Returns: file tree with metadata

3. **GET /public/{owner}/{repo}/{gitRef}/{filepath}**
   - Returns: file content (text, images, etc.)

**Repository Overview:**
4. **GET /api/repo/{owner}/{repo}/stats**
   - Returns: repository statistics (total deployments, storage, branches, aliases)

5. **GET /api/repo/{owner}/{repo}/deployments**
   - Returns: paginated deployments list with filtering/sorting

6. **GET /api/repo/{owner}/{repo}/aliases**
   - Returns: list of all aliases for the repository

## Adding New Tests

1. **Use the mock helpers:**
   ```typescript
   import { mockRepositoryAPI } from './helpers/mock-api';

   test('my new test', async ({ page }) => {
     await mockRepositoryAPI(page, 'owner', 'repo');
     // ... rest of test
   });
   ```

2. **Add new mock data if needed:**
   - Edit `fixtures/mock-data.ts` to add new files or modify existing data

3. **Test error scenarios:**
   ```typescript
   import { mockRepositoryNotFound, mockNetworkError } from './helpers/mock-api';

   test('handles errors', async ({ page }) => {
     await mockRepositoryNotFound(page, 'owner', 'repo');
     // ... test error handling
   });
   ```

## Debugging Tests

### View Test Results

```bash
# Open HTML report
pnpm playwright show-report
```

### Debug with VS Code

The Playwright extension for VS Code allows you to:
- Run tests with debugging
- Set breakpoints
- Step through test code
- Inspect page state

### Screenshots and Traces

Tests automatically capture:
- Screenshots on failure
- Traces on first retry (can be viewed in the HTML report)

## Best Practices

1. **Always mock API calls** - Tests should not depend on real backend
2. **Use data-testid attributes** - Prefer `data-testid` over brittle selectors
3. **Wait for states** - Use `waitForLoadState('networkidle')` or specific element visibility
4. **Test error states** - Include tests for 404s, network errors, etc.
5. **Keep mock data realistic** - Mock data should match production API structure
6. **Test accessibility** - Use `role` attributes and semantic selectors

## Configuration

See `playwright.config.ts` for:
- Browser configurations
- Base URL
- Timeout settings
- Reporter options
- Dev server configuration
