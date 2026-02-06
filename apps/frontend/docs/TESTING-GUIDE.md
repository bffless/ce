# Repository Browser - Testing Guide

Comprehensive guide to testing the repository browser feature.

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Test Types](#test-types)
3. [Running Tests](#running-tests)
4. [Writing Unit Tests](#writing-unit-tests)
5. [Writing Component Tests](#writing-component-tests)
6. [Writing Integration Tests](#writing-integration-tests)
7. [Writing E2E Tests](#writing-e2e-tests)
8. [Test Coverage](#test-coverage)
9. [CI/CD Integration](#cicd-integration)
10. [Best Practices](#best-practices)

---

## Testing Philosophy

Our testing strategy follows the **Testing Trophy** model:

```
      /\
     /  \    E2E Tests (few, critical paths)
    /    \
   /------\  Integration Tests (some, key workflows)
  /        \
 /----------\ Unit Tests (many, comprehensive)
/___Static___\
   Analysis    Linting, TypeScript
```

### Key Principles

1. **Test behavior, not implementation**
2. **Write tests that give confidence**
3. **Keep tests simple and readable**
4. **Avoid testing third-party libraries**
5. **Mock external dependencies**

---

## Test Types

### 1. Unit Tests

- Test individual functions and components in isolation
- Fast, focused, and numerous
- Framework: Vitest + React Testing Library

### 2. Integration Tests

- Test multiple components/modules working together
- Medium scope, testing workflows
- Framework: Vitest + Redux

### 3. E2E Tests

- Test complete user flows in real browser
- Slow but comprehensive
- Framework: Playwright

### 4. Static Analysis

- TypeScript type checking
- ESLint for code quality
- Prettier for formatting

---

## Running Tests

### Quick Commands

```bash
# Run all unit and integration tests
pnpm test

# Run tests without coverage
pnpm test:run

# Run tests in watch mode (interactive)
pnpm test:ui

# Run tests with coverage report
pnpm test:coverage

# Run E2E tests
pnpm test:e2e

# Run E2E tests with UI
pnpm test:e2e:ui

# Run E2E tests in headed mode (see browser)
pnpm test:e2e:headed

# Debug E2E tests
pnpm test:e2e:debug
```

### Run Specific Tests

```bash
# Run tests in a specific file
pnpm test:run src/lib/file-tree.test.ts

# Run tests matching a pattern
pnpm test:run --grep "file tree"

# Run E2E tests for a specific spec
pnpm test:e2e repository-browser.spec.ts
```

### Watch Mode

```bash
# Start watch mode
vitest

# In watch mode:
# - Press 'a' to run all tests
# - Press 'f' to run only failed tests
# - Press 'p' to filter by filename
# - Press 't' to filter by test name
# - Press 'q' to quit
```

---

## Writing Unit Tests

### File Structure

Place test files next to the code they test:

```
src/
  lib/
    file-tree.ts
    file-tree.test.ts      # Unit test
  components/
    FileIcon.tsx
    FileIcon.test.tsx      # Component test
```

### Example: Testing Pure Functions

**file-tree.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { buildFileTree } from './file-tree';

describe('buildFileTree', () => {
  it('should build tree from flat file list', () => {
    const files = [
      { path: 'index.html', fileName: 'index.html', size: 100 },
      { path: 'css/style.css', fileName: 'style.css', size: 50 },
    ];

    const tree = buildFileTree(files);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      type: 'file',
      name: 'index.html',
    });
    expect(tree[1]).toMatchObject({
      type: 'directory',
      name: 'css',
    });
  });

  it('should sort folders before files', () => {
    const files = [
      { path: 'README.md', fileName: 'README.md', size: 100 },
      { path: 'src/index.ts', fileName: 'index.ts', size: 50 },
    ];

    const tree = buildFileTree(files);

    expect(tree[0].type).toBe('directory'); // src folder
    expect(tree[1].type).toBe('file'); // README.md
  });
});
```

### Example: Testing Redux Slices

**repoSlice.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import repoReducer, { setCurrentRepo, clearRepoState } from './repoSlice';

describe('repoSlice', () => {
  it('should set current repo', () => {
    const initialState = { currentRepo: null /* ... */ };

    const action = setCurrentRepo({ owner: 'user', repo: 'repo' });
    const state = repoReducer(initialState, action);

    expect(state.currentRepo).toEqual({ owner: 'user', repo: 'repo' });
  });

  it('should clear repo state', () => {
    const populatedState = {
      currentRepo: { owner: 'user', repo: 'repo' },
      currentRef: 'main',
      /* ... */
    };

    const action = clearRepoState();
    const state = repoReducer(populatedState, action);

    expect(state.currentRepo).toBeNull();
    expect(state.currentRef).toBeNull();
  });
});
```

---

## Writing Component Tests

### Setup

Components tests use React Testing Library.

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
```

### Example: Simple Component

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileIcon } from './FileIcon';

describe('FileIcon', () => {
  it('should render HTML icon', () => {
    render(<FileIcon fileName="index.html" />);

    const icon = screen.getByRole('img', { hidden: true });
    expect(icon).toBeInTheDocument();
  });

  it('should render folder icon when isFolder is true', () => {
    render(<FileIcon fileName="src" isFolder={true} />);

    // Check for folder icon class or data attribute
    const icon = screen.getByRole('img', { hidden: true });
    expect(icon).toHaveClass('lucide-folder');
  });
});
```

### Example: Component with User Interaction

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('SearchInput', () => {
  it('should call onChange when typing', async () => {
    const handleChange = vi.fn();
    render(<SearchInput onChange={handleChange} />);

    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, 'test');

    expect(handleChange).toHaveBeenCalledWith('test');
  });

  it('should clear on Escape key', async () => {
    const handleChange = vi.fn();
    render(<SearchInput value="test" onChange={handleChange} />);

    const input = screen.getByPlaceholderText(/search/i);
    await userEvent.type(input, '{Escape}');

    expect(handleChange).toHaveBeenCalledWith('');
  });
});
```

### Example: Component with Redux

```typescript
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { FileBrowserSidebar } from './FileBrowserSidebar';
import repoReducer from '@/store/slices/repoSlice';
import uiReducer from '@/store/slices/uiSlice';

const createTestStore = () => {
  return configureStore({
    reducer: {
      repo: repoReducer,
      ui: uiReducer,
    },
  });
};

describe('FileBrowserSidebar', () => {
  it('should render file tree', () => {
    const store = createTestStore();

    render(
      <Provider store={store}>
        <FileBrowserSidebar />
      </Provider>
    );

    expect(screen.getByText(/files/i)).toBeInTheDocument();
  });
});
```

### Example: Mocking API Calls

```typescript
import { vi } from 'vitest';

// Mock RTK Query hook
vi.mock('@/services/repoApi', () => ({
  useGetFileTreeQuery: () => ({
    data: {
      files: [
        { path: 'index.html', fileName: 'index.html', size: 100 },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

describe('FileBrowserSidebar', () => {
  it('should display files from API', () => {
    render(<FileBrowserSidebar />);

    expect(screen.getByText('index.html')).toBeInTheDocument();
  });
});
```

---

## Writing Integration Tests

Integration tests verify multiple components working together.

**Location:** `src/test/integration/`

### Example: Store Integration

```typescript
import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import repoReducer from '@/store/slices/repoSlice';
import uiReducer from '@/store/slices/uiSlice';

describe('Repository Navigation Integration', () => {
  it('should handle full navigation workflow', () => {
    const store = configureStore({
      reducer: {
        repo: repoReducer,
        ui: uiReducer,
      },
    });

    // 1. Set repository
    store.dispatch({
      type: 'repo/setCurrentRepo',
      payload: { owner: 'user', repo: 'repo' },
    });

    // 2. Search for file
    store.dispatch({
      type: 'ui/setFileBrowserSearchQuery',
      payload: 'index',
    });

    // 3. Select file
    store.dispatch({
      type: 'repo/setCurrentFilePath',
      payload: 'index.html',
    });

    // Verify final state
    const state = store.getState();
    expect(state.repo.currentRepo?.repo).toBe('repo');
    expect(state.ui.fileBrowser.searchQuery).toBe('index');
    expect(state.repo.currentFilePath).toBe('index.html');
  });
});
```

---

## Writing E2E Tests

E2E tests use Playwright to test in real browsers.

**Location:** `e2e/`

### Basic Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/your-page');
  });

  test('should do something', async ({ page }) => {
    // Arrange: Set up test state
    // Act: Perform actions
    // Assert: Verify results
  });
});
```

### Example: Navigation Test

```typescript
test('should navigate from sidebar to file', async ({ page }) => {
  await page.goto('/repo/testuser/test-repo/main');

  // Find and click file
  const file = page.locator('[role="treeitem"]').filter({ hasText: 'index.html' });
  await file.click();

  // Wait for content to load
  await page.waitForLoadState('networkidle');

  // Verify URL updated
  expect(page.url()).toContain('index.html');

  // Verify content visible
  const content = page.locator('[data-testid="content-viewer"]');
  await expect(content).toBeVisible();
});
```

### Example: Form Interaction

```typescript
test('should search for files', async ({ page }) => {
  await page.goto('/repo/testuser/test-repo/main');

  // Type in search
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.fill('index');

  // Wait for results
  await page.waitForTimeout(300);

  // Verify filtered results
  const results = page.locator('[role="treeitem"]');
  const count = await results.count();
  expect(count).toBeGreaterThan(0);

  // Clear search
  await searchInput.press('Escape');
  await expect(searchInput).toHaveValue('');
});
```

### Example: Mobile Testing

```typescript
test.describe('Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('should open sidebar on mobile', async ({ page }) => {
    await page.goto('/repo/testuser/test-repo/main');

    // Click hamburger menu
    const hamburger = page.locator('button[aria-label*="menu"]');
    await hamburger.click();

    // Sidebar should be visible
    const sidebar = page.locator('[data-testid="file-browser-sidebar"]');
    await expect(sidebar).toBeVisible();
  });
});
```

### Waiting Strategies

```typescript
// Wait for element to be visible
await expect(page.locator('.my-element')).toBeVisible();

// Wait for network to be idle
await page.waitForLoadState('networkidle');

// Wait for specific request
await page.waitForResponse((resp) => resp.url().includes('/api/files'));

// Wait for timeout (use sparingly)
await page.waitForTimeout(300);
```

### Debugging E2E Tests

```bash
# Run with browser visible
pnpm test:e2e:headed

# Run in debug mode (step through)
pnpm test:e2e:debug

# View trace after failure
pnpm playwright show-report
```

---

## Test Coverage

### Viewing Coverage

```bash
# Generate coverage report
pnpm test:coverage

# Open HTML report
open coverage/index.html
```

### Coverage Targets

| Metric     | Target | Current |
| ---------- | ------ | ------- |
| Statements | >80%   | 85.07%  |
| Branches   | >75%   | 82.74%  |
| Functions  | >80%   | 87.17%  |
| Lines      | >80%   | 85.71%  |

### Coverage by Area

- **Redux Slices**: 100% (repoSlice, uiSlice)
- **Utilities**: 100% (utils, file-tree)
- **Components**: 90%+ (FileBrowserSidebar, FileIcon, TreeNode)
- **UI Components**: 96% (shadcn/ui wrappers)

### Improving Coverage

Focus on:

1. Edge cases and error handling
2. Conditional branches
3. Async operations
4. User interaction flows

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: pnpm install

      - name: Run linter
        run: pnpm lint

      - name: Run unit tests
        run: pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

      - name: Run E2E tests
        run: pnpm test:e2e
```

---

## Best Practices

### General

1. **Arrange-Act-Assert**: Structure tests clearly
2. **One assertion per test**: Keep tests focused
3. **Descriptive names**: Test name should explain what it tests
4. **Avoid implementation details**: Test behavior, not internals
5. **Keep tests independent**: No shared state between tests

### Component Testing

1. **Use semantic queries**: `getByRole`, `getByLabelText`, not `getByClassName`
2. **Test accessibility**: Verify ARIA labels and keyboard navigation
3. **Mock external dependencies**: Don't test third-party code
4. **Test error states**: Verify error handling
5. **Avoid snapshot tests**: Prefer explicit assertions

### E2E Testing

1. **Test critical paths**: Focus on user workflows
2. **Keep tests stable**: Use reliable selectors
3. **Minimize waits**: Use smart waiting strategies
4. **Test on multiple browsers**: Use Playwright projects
5. **Clean up after tests**: Reset state, delete test data

### Naming Conventions

```typescript
// Good
it('should display error message when API fails');
it('should filter files when search query is entered');
it('should navigate to file when clicked in tree');

// Bad
it('works'); // Too vague
it('test the component'); // Not descriptive
it('should call handleClick'); // Testing implementation
```

### Test Organization

```typescript
describe('ComponentName', () => {
  // Group related tests
  describe('rendering', () => {
    it('should render with default props', () => {});
    it('should render with custom props', () => {});
  });

  describe('user interactions', () => {
    it('should handle click', () => {});
    it('should handle keyboard input', () => {});
  });

  describe('error handling', () => {
    it('should display error message', () => {});
    it('should retry on error', () => {});
  });
});
```

---

## Common Pitfalls

### 1. Testing Implementation Details

```typescript
// Bad: Testing internal state
expect(component.state.isOpen).toBe(true);

// Good: Testing user-visible behavior
expect(screen.getByRole('dialog')).toBeVisible();
```

### 2. Not Waiting for Async Operations

```typescript
// Bad: Assertion runs before data loads
render(<Component />);
expect(screen.getByText('Data')).toBeInTheDocument(); // Fails

// Good: Wait for element
render(<Component />);
await waitFor(() => {
  expect(screen.getByText('Data')).toBeInTheDocument();
});
```

### 3. Flaky E2E Tests

```typescript
// Bad: Hard-coded timeout
await page.waitForTimeout(1000); // Might be too short or too long

// Good: Wait for specific condition
await expect(page.locator('.data-loaded')).toBeVisible();
```

### 4. Testing Third-Party Libraries

```typescript
// Bad: Testing React Router
expect(history.push).toHaveBeenCalledWith('/path');

// Good: Testing your component's behavior
expect(screen.getByRole('link')).toHaveAttribute('href', '/path');
```

---

## Debugging Tests

### Vitest Debugging

```typescript
// Use vi.debug() to print current DOM
import { render, screen, vi } from '@testing-library/react';

render(<Component />);
screen.debug(); // Prints DOM tree
```

### Playwright Debugging

```typescript
// Add breakpoint
await page.pause();

// Take screenshot
await page.screenshot({ path: 'debug.png' });

// Print page content
console.log(await page.content());
```

### VSCode Integration

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Vitest Tests",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["test:run", "--inspect-brk", "--no-coverage"],
  "console": "integratedTerminal"
}
```

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Trophy Model](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)

---

**Happy Testing! 🧪**
