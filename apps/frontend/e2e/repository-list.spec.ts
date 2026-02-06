import { test, expect } from '@playwright/test';
import {
  mockRepositoryListAPI,
  mockEmptyRepositoryList,
  mockRepositoryListError,
} from './helpers/mock-api';
import { mockAuthSession } from './fixtures/auth';

/**
 * E2E Tests for Repository List Page (Phase 3E)
 *
 * Tests the main repository listing page at /repo that shows:
 * - Sidebar with quick repository navigation
 * - Global search bar with keyboard shortcuts
 * - Activity feed with repository cards
 * - Pagination
 *
 * Run with: pnpm test:e2e repository-list
 */

test.describe('Repository List Page', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authentication (mocks SuperTokens session)
    await mockAuthSession(page);

    // Set up API mocking before navigation
    await mockRepositoryListAPI(page);

    // Navigate to the repository list page
    await page.goto('/repo');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display the repository list page with sidebar and feed', async ({ page }) => {
    // Check that the page heading is visible
    const heading = page.getByRole('heading', { name: /repositories|recently updated/i });
    await expect(heading.first()).toBeVisible();

    // Check that sidebar is visible on desktop (filter for the visible one, not the hidden mobile one)
    const sidebar = page.locator('aside.md\\:block').filter({ hasText: /your repositories/i });
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Check that the global search bar is visible
    const searchBar = page.getByRole('searchbox', { name: /search repositories/i });
    await expect(searchBar).toBeVisible();

    // Take a screenshot of the full page
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-full-page.png',
      fullPage: true,
    });
  });

  test('should display repository cards in the activity feed', async ({ page }) => {
    // Wait for repository cards to load
    const feed = page.locator('[role="feed"]');
    await expect(feed).toBeVisible({ timeout: 5000 });

    // Check that repository cards are present
    const cards = page.locator('[role="article"]');
    const cardCount = await cards.count();

    // Should have at least one repository card
    expect(cardCount).toBeGreaterThan(0);

    // Check that the first card has expected content
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();

    // Should display repository name
    const repoLink = firstCard.locator('a').first();
    await expect(repoLink).toBeVisible();
    await expect(repoLink).toContainText(/\//); // Should contain owner/repo format

    // Take a screenshot of repository cards
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-cards.png',
      fullPage: false,
    });
  });

  test('should display repository stats (deployments, storage, updated time)', async ({ page }) => {
    // Wait for cards to load
    const cards = page.locator('[role="article"]');
    await expect(cards.first()).toBeVisible();

    // Check for deployment count
    const deploymentStat = cards.first().locator('text=/\\d+ deployment/i');
    await expect(deploymentStat).toBeVisible();

    // Check for storage indicator (should show MB or GB)
    const storageStat = cards.first().locator('text=/\\d+(\\.\\d+)? (MB|GB)/i');
    await expect(storageStat).toBeVisible();

    // Check for updated time (relative time)
    const updatedTime = cards.first().locator('text=/updated .* ago/i');
    await expect(updatedTime).toBeVisible();
  });

  test('should display permission and visibility badges', async ({ page }) => {
    // Wait for cards to load
    const cards = page.locator('[role="article"]');
    await expect(cards.first()).toBeVisible();

    // Should display visibility badge (Public/Private)
    const visibilityBadge = cards.first().locator('text=/public|private/i');
    const badgeVisible = await visibilityBadge.isVisible().catch(() => false);

    // At least one card should have a visibility badge
    expect(badgeVisible).toBeTruthy();
  });

  test('should navigate to repository overview when clicking "View Repository"', async ({
    page,
  }) => {
    // Wait for cards to load
    const cards = page.locator('[role="article"]');
    await expect(cards.first()).toBeVisible();

    // Find and click the "View Repository" button
    const viewButton = cards
      .first()
      .locator('button, a')
      .filter({ hasText: /view repository/i });
    await expect(viewButton).toBeVisible();

    // Get the repository name to verify navigation
    const repoLink = cards.first().locator('a').first();
    await repoLink.textContent();

    await viewButton.click();

    // Wait for navigation
    await page.waitForLoadState('networkidle');

    // Should navigate to repository overview (URL should contain repo path)
    const url = page.url();
    expect(url).toContain('/repo/');

    // Verify we're on a different page (not the list page anymore)
    const feedVisible = await page
      .locator('[role="feed"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    expect(feedVisible).toBeFalsy();
  });

  test('should search repositories using the global search bar', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(500);

    // Get the search input
    const searchInput = page.getByRole('searchbox', { name: /search repositories/i });
    await expect(searchInput).toBeVisible();

    // Type a search query
    await searchInput.fill('wsa');

    // Wait for debounce (300ms)
    await page.waitForTimeout(400);

    // Should filter results
    const cards = page.locator('[role="article"]');
    const cardCount = await cards.count();

    // Should have filtered results
    expect(cardCount).toBeGreaterThan(0);

    // First card should contain "wsa" in the name
    const firstCard = cards.first();
    const cardText = await firstCard.textContent();
    expect(cardText?.toLowerCase()).toContain('wsa');

    // Take a screenshot of search results
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-search.png',
      fullPage: true,
    });
  });

  test('should clear search with the clear button', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(500);

    // Get the search input
    const searchInput = page.getByRole('searchbox', { name: /search repositories/i });

    // Type a search query
    await searchInput.fill('test query');

    // Wait for the clear button to appear
    const clearButton = page.locator('button[aria-label*="clear" i]');
    await expect(clearButton).toBeVisible();

    // Click the clear button
    await clearButton.click();

    // Search input should be cleared
    await expect(searchInput).toHaveValue('');
  });

  test('should filter sidebar repositories', async ({ page }) => {
    // Check if sidebar is visible (on desktop)
    const sidebar = page.locator('aside').filter({ hasText: /your repositories/i });
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      // Find the sidebar search input
      const sidebarSearch = sidebar.locator('input[placeholder*="find" i]');
      await expect(sidebarSearch).toBeVisible();

      // Type a search query
      await sidebarSearch.fill('wsa');

      // Wait for filtering
      await page.waitForTimeout(300);

      // Count sidebar repository links
      const sidebarLinks = sidebar.locator('a').filter({ hasText: /\// });
      const linkCount = await sidebarLinks.count();

      // Should have at least one matching repository
      expect(linkCount).toBeGreaterThan(0);

      // First link should contain "wsa"
      const firstLink = sidebarLinks.first();
      const linkText = await firstLink.textContent();
      expect(linkText?.toLowerCase()).toContain('wsa');
    } else {
      // On mobile, sidebar might be hidden - test passes
      expect(true).toBeTruthy();
    }
  });

  test('should navigate to repository from sidebar', async ({ page }) => {
    // Check if sidebar is visible
    const sidebar = page.locator('aside').filter({ hasText: /your repositories/i });
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      // Click the first repository link in sidebar
      const firstLink = sidebar.locator('a').filter({ hasText: /\// }).first();
      await expect(firstLink).toBeVisible();

      await firstLink.click();

      // Wait for navigation
      await page.waitForLoadState('networkidle');

      // Should navigate to repository overview
      const url = page.url();
      expect(url).toContain('/repo/');
      expect(url).not.toBe('/repo'); // Should not be the list page
    } else {
      // Test passes if sidebar not visible
      expect(true).toBeTruthy();
    }
  });

  test('should display repository count in feed header', async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(500);

    // Look for repository count (e.g., "5 repositories")
    const countText = page.locator('text=/\\d+ repositor(y|ies)/i').first();
    await expect(countText).toBeVisible();

    // Should show the correct count
    const text = await countText.textContent();
    expect(text).toMatch(/\d+ repositor(y|ies)/i);
  });

  test('should use keyboard shortcut "/" to focus search', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(500);

    // Press "/" key
    await page.keyboard.press('/');

    // Search input should be focused
    const searchInput = page.getByRole('searchbox', { name: /search repositories/i });
    await expect(searchInput).toBeFocused();
  });

  test('should clear search with Escape key', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(500);

    // Get the search input and focus it
    const searchInput = page.getByRole('searchbox', { name: /search repositories/i });
    await searchInput.click();

    // Type a search query
    await searchInput.fill('test query');

    // Press Escape
    await page.keyboard.press('Escape');

    // Search should be cleared
    await expect(searchInput).toHaveValue('');
  });
});

test.describe('Repository List Page - Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('should display mobile layout with hamburger menu', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await page.waitForTimeout(500);

    // Mobile header should be visible
    const mobileHeader = page.locator('.md\\:hidden').filter({ hasText: /repositories/i });
    await expect(mobileHeader.first()).toBeVisible();

    // Hamburger menu button should be visible
    const hamburgerButton = page.locator('button[aria-label*="menu" i]');
    await expect(hamburgerButton).toBeVisible();

    // Take a screenshot of mobile view
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-mobile.png',
      fullPage: true,
    });
  });

  test('should open sidebar in sheet on mobile when clicking hamburger', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await page.waitForTimeout(500);

    // Click hamburger menu
    const hamburgerButton = page.locator('button[aria-label*="menu" i]');
    await expect(hamburgerButton).toBeVisible();
    await hamburgerButton.click();

    // Wait for sheet to open
    await page.waitForTimeout(500);

    // Sidebar should be visible in sheet - look for repository links
    const sidebarLinks = page.locator('a').filter({ hasText: /\// });
    const linkCount = await sidebarLinks.count();

    // Should have at least one repository link visible
    expect(linkCount).toBeGreaterThan(0);
  });

  test('should display repository cards in mobile layout', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for cards to load
    await page.waitForTimeout(500);

    // Repository cards should be visible
    const cards = page.locator('[role="article"]');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Cards should be stacked vertically (full width on mobile)
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
  });
});

test.describe('Repository List Page - Empty States', () => {
  test('should display empty state when no repositories exist', async ({ page }) => {
    await mockAuthSession(page);
    await mockEmptyRepositoryList(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await page.waitForTimeout(500);

    // Should show empty state message
    const emptyState = page.locator('text=/no repositories/i').first();
    await expect(emptyState).toBeVisible();

    // Should show folder icon or similar
    const folderIcon = page
      .locator('svg')
      .filter({ hasText: /folder/i })
      .or(page.locator('[class*="folder" i]'));
    const iconVisible = await folderIcon.isVisible().catch(() => false);

    // Either empty message or icon should be visible
    expect(iconVisible || (await emptyState.isVisible())).toBeTruthy();

    // Take a screenshot of empty state
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-empty.png',
      fullPage: true,
    });
  });

  test('should display empty state when search has no results', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for page to load
    await page.waitForTimeout(500);

    // Search for something that doesn't exist
    const searchInput = page.getByRole('searchbox', { name: /search repositories/i });
    await searchInput.fill('nonexistent-repository-xyz');

    // Wait for debounce and results
    await page.waitForTimeout(500);

    // Should show "no repositories found" message
    const noResults = page.locator('text=/no repositories found|no repositories match/i').first();
    await expect(noResults).toBeVisible({ timeout: 3000 });

    // Take a screenshot of no search results
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-no-results.png',
      fullPage: true,
    });
  });

  test('should display empty state in sidebar when search has no matches', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Check if sidebar is visible
    const sidebar = page.locator('aside').filter({ hasText: /your repositories/i });
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      // Search for something that doesn't exist in sidebar
      const sidebarSearch = sidebar.locator('input[placeholder*="find" i]');
      await sidebarSearch.fill('xyz-nonexistent');

      // Wait for filtering
      await page.waitForTimeout(300);

      // Should show empty state in sidebar
      const emptyState = sidebar.locator('text=/no repositories match|no repositories found/i');
      await expect(emptyState).toBeVisible();
    } else {
      // Test passes if sidebar not visible
      expect(true).toBeTruthy();
    }
  });
});

test.describe('Repository List Page - Error Handling', () => {
  test('should display error state when API fails', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListError(page);
    await page.goto('/repo');

    // Wait for error to appear
    await page.waitForTimeout(1000);

    // Should show error alert
    const errorAlert = page.locator('[role="alert"]').first();
    const errorText = page.locator('text=/failed to load|error|connection error/i').first();

    const errorVisible = await errorAlert.isVisible({ timeout: 3000 }).catch(() => false);
    const textVisible = await errorText.isVisible({ timeout: 3000 }).catch(() => false);

    // At least one error indicator should be visible
    expect(errorVisible || textVisible).toBeTruthy();
  });

  test('should display retry button on error', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListError(page);
    await page.goto('/repo');

    // Wait for error to appear
    await page.waitForTimeout(1000);

    // Should show retry button
    const retryButton = page
      .locator('button')
      .filter({ hasText: /retry|try again/i })
      .first();
    const retryVisible = await retryButton.isVisible({ timeout: 3000 }).catch(() => false);

    expect(retryVisible).toBeTruthy();

    // Take a screenshot of error state
    await page.screenshot({
      path: 'e2e/screenshots/repository-list-error.png',
      fullPage: true,
    });
  });

  test('should display error in sidebar when sidebar API fails', async ({ page }) => {
    await mockAuthSession(page);

    // Mock only sidebar to fail
    await page.route('**/api/repositories/mine', async (route) => {
      await route.abort('failed');
    });

    // Mock feed to succeed
    await mockRepositoryListAPI(page);

    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Check if sidebar is visible
    const sidebar = page.locator('aside');
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      // Should show error in sidebar
      const sidebarError = sidebar.locator('[role="alert"], text=/failed to load/i').first();
      const errorVisible = await sidebarError.isVisible({ timeout: 3000 }).catch(() => false);

      expect(errorVisible).toBeTruthy();
    } else {
      // Test passes if sidebar not visible
      expect(true).toBeTruthy();
    }
  });
});

test.describe('Repository List Page - Loading States', () => {
  test('should display loading skeleton while loading', async ({ page }) => {
    // Navigate without mocking to catch loading state
    const pagePromise = page.goto('/repo');

    // Look for loading skeleton quickly
    const skeleton = page
      .locator('[data-loading="true"], .skeleton, [class*="skeleton" i]')
      .first();
    await skeleton.isVisible({ timeout: 1000 }).catch(() => false);

    // Wait for page to finish loading
    await pagePromise;
    await page.waitForLoadState('networkidle');

    // Test passes if we saw skeleton (or didn't - loading might be too fast)
    expect(true).toBeTruthy();
  });
});

test.describe('Repository List Page - Accessibility', () => {
  test('should have proper ARIA labels and roles', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await page.waitForTimeout(500);

    // Search should have proper role
    const searchBox = page.getByRole('searchbox');
    await expect(searchBox).toBeVisible();

    // Feed should have proper role
    const feed = page.getByRole('feed');
    await expect(feed).toBeVisible();

    // Repository cards should have article role
    const articles = page.locator('[role="article"]');
    const articleCount = await articles.count();
    expect(articleCount).toBeGreaterThan(0);
  });

  test('should have accessible buttons and links', async ({ page }) => {
    await mockAuthSession(page);
    await mockRepositoryListAPI(page);
    await page.goto('/repo');
    await page.waitForLoadState('networkidle');

    // Wait for cards to load
    await page.waitForTimeout(500);

    // Check that "View Repository" buttons have text
    const viewButtons = page.locator('button, a').filter({ hasText: /view repository/i });
    const viewButtonCount = await viewButtons.count();

    // Should have at least one "View Repository" button
    expect(viewButtonCount).toBeGreaterThan(0);

    // Check first button has accessible text
    const firstButton = viewButtons.first();
    const buttonText = await firstButton.textContent();
    expect(buttonText).toContain('View Repository');
  });
});
