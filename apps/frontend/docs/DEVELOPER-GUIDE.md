# Repository Browser - Developer Guide

Technical documentation for developers working on the repository browser feature.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [State Management](#state-management)
5. [Component Reference](#component-reference)
6. [API Integration](#api-integration)
7. [Testing](#testing)
8. [Development Workflow](#development-workflow)
9. [Performance Considerations](#performance-considerations)
10. [Contributing](#contributing)

---

## Architecture Overview

The repository browser follows a **Redux + RTK Query** architecture with React Router for navigation.

### High-Level Flow

```
URL Change (React Router)
    ↓
RepositoryPage Component
    ↓
Dispatch Redux Actions (update state)
    ↓
RTK Query Fetches Data (file tree, refs)
    ↓
Components Render (FileBrowserSidebar, ContentViewer)
    ↓
User Interactions
    ↓
Update URL or Redux State
    ↓
Loop
```

### Key Principles

1. **URL as Source of Truth**: Current repo, ref, and file path are in the URL
2. **Redux for UI State**: Sidebar open/closed, expanded paths, search query
3. **RTK Query for Server State**: File tree, refs, file content (cached)
4. **Component Composition**: Small, focused components with clear responsibilities

---

## Technology Stack

### Core Libraries

- **React 18**: UI library
- **Redux Toolkit 2.0**: State management
- **RTK Query**: Data fetching and caching
- **React Router v6**: Client-side routing
- **TypeScript 5**: Type safety

### UI & Styling

- **Tailwind CSS 3**: Utility-first styling
- **shadcn/ui**: Pre-built accessible components
- **Radix UI**: Headless UI primitives
- **Lucide React**: Icon library

### Syntax Highlighting

- **Shiki 3**: Code syntax highlighting with VS Code themes

### Image Viewer

- **react-zoom-pan-pinch**: Zoom and pan functionality

### Build Tools

- **Vite 5**: Fast build tool and dev server
- **TypeScript Compiler**: Type checking

### Testing

- **Vitest 4**: Unit and integration tests
- **React Testing Library**: Component testing
- **Playwright**: E2E tests
- **happy-dom**: Fast DOM simulation

---

## Project Structure

```
apps/frontend/
├── src/
│   ├── components/
│   │   ├── repo/                   # Repository-specific components
│   │   │   ├── FileBrowserSidebar.tsx
│   │   │   ├── TreeNode.tsx
│   │   │   ├── FileIcon.tsx
│   │   │   ├── ContentViewer.tsx
│   │   │   ├── CodeViewer.tsx
│   │   │   ├── HtmlPreview.tsx
│   │   │   ├── ImageViewer.tsx
│   │   │   ├── RepoBreadcrumb.tsx
│   │   │   ├── RefSelector.tsx
│   │   │   ├── BrowserTabs.tsx
│   │   │   ├── FileActions.tsx
│   │   │   └── FileMetadata.tsx
│   │   └── ui/                     # shadcn/ui components
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       ├── scroll-area.tsx
│   │       └── ...
│   ├── pages/
│   │   └── RepositoryPage.tsx      # Main page component
│   ├── store/
│   │   ├── index.ts                # Redux store config
│   │   └── slices/
│   │       ├── repoSlice.ts        # Repository state
│   │       └── uiSlice.ts          # UI state
│   ├── services/
│   │   ├── api.ts                  # Base RTK Query API
│   │   └── repoApi.ts              # Repository API endpoints
│   ├── lib/
│   │   ├── file-tree.ts            # File tree utilities
│   │   ├── syntax-highlighter.ts   # Shiki integration
│   │   ├── focus-management.ts     # Accessibility utilities
│   │   └── utils.ts                # General utilities
│   ├── hooks/
│   │   └── use-media-query.ts      # Responsive breakpoint hook
│   └── test/
│       ├── setup.ts                # Test configuration
│       └── integration/            # Integration tests
├── e2e/                            # Playwright E2E tests
├── docs/                           # Documentation
│   ├── USER-GUIDE.md
│   └── DEVELOPER-GUIDE.md
├── playwright.config.ts
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## State Management

### Redux Slices

#### `repoSlice.ts` - Repository State

Manages current repository, ref, file path, and selected file.

**State:**

```typescript
interface RepoState {
  currentRepo: { owner: string; repo: string } | null;
  currentRef: string | null;
  currentFilePath: string | null;
  selectedFile: {
    path: string;
    name: string;
    size?: number;
    mimeType?: string;
  } | null;
}
```

**Actions:**

- `setCurrentRepo(payload)` - Set owner and repo
- `setCurrentRef(payload)` - Set branch/commit/alias
- `setCurrentFilePath(payload)` - Set current file path
- `selectFile(payload)` - Set selected file with metadata
- `clearRepoState()` - Reset all state

**Usage:**

```typescript
import { useDispatch, useSelector } from 'react-redux';
import { setCurrentRepo } from '@/store/slices/repoSlice';

const dispatch = useDispatch();
const currentRepo = useSelector((state) => state.repo.currentRepo);

dispatch(setCurrentRepo({ owner: 'user', repo: 'repo' }));
```

#### `uiSlice.ts` - UI State

Manages sidebar, tabs, search, and expanded folders.

**State:**

```typescript
interface UiState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activeTab: 'code' | 'preview' | 'history';
  fileBrowser: {
    searchQuery: string;
    expandedPaths: string[];
  };
}
```

**Actions:**

- `toggleSidebar()` - Toggle sidebar open/closed
- `setSidebarOpen(payload)` - Set sidebar state
- `setSidebarWidth(payload)` - Set sidebar width
- `setActiveTab(payload)` - Set active tab
- `setFileBrowserSearchQuery(payload)` - Set search query
- `setFileBrowserExpandedPaths(payload)` - Set expanded paths
- `toggleFileBrowserPath(payload)` - Toggle single path

**Local Storage:**

- `sidebarOpen` and `sidebarWidth` persist to localStorage
- Automatically loaded on app init

---

## Component Reference

### Page Components

#### `RepositoryPage`

Main page component that orchestrates the repository browser.

**Responsibilities:**

- Extract URL params (owner, repo, ref, filepath)
- Dispatch Redux actions on mount
- Fetch file tree and refs data
- Render layout with FileBrowserSidebar and ContentViewer
- Handle loading and error states

**Props:** None (uses React Router hooks)

**Key Hooks:**

- `useParams()` - Get URL params
- `useGetFileTreeQuery()` - Fetch file tree
- `useGetRepositoryRefsQuery()` - Fetch refs
- `useDispatch()` - Dispatch actions

---

### File Browser Components

#### `FileBrowserSidebar`

Main sidebar component with file tree and search.

**Props:** None (uses Redux state)

**Features:**

- Search input with live filtering
- File tree rendering
- Loading skeleton
- Empty state
- Error state with retry

**Keyboard Shortcuts:**

- `/` - Focus search
- `Esc` - Clear search

**Test File:** `FileBrowserSidebar.test.tsx` (40 tests)

---

#### `TreeNode`

Recursive tree node component for folders and files.

**Props:**

```typescript
interface TreeNodeProps {
  node: TreeNode;
  level: number;
  currentPath?: string;
}
```

**Features:**

- Recursive rendering for nested folders
- Expand/collapse chevron
- Active file highlighting
- Click to navigate
- Keyboard navigation (Enter, Space, Arrow keys)

**State:**

- Uses Redux `expandedPaths` and `focusedPath`

---

#### `FileIcon`

Displays appropriate icon for file type.

**Props:**

```typescript
interface FileIconProps {
  fileName: string;
  isFolder?: boolean;
  isOpen?: boolean;
  className?: string;
}
```

**Features:**

- 50+ file type icon mappings
- Color coding by file type
- Folder open/closed states

**Test File:** `FileIcon.test.tsx` (33 tests)

---

### Content Viewer Components

#### `ContentViewer`

Orchestrates content display based on file type.

**Props:**

```typescript
interface ContentViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath?: string;
}
```

**Features:**

- Determines viewer based on MIME type
- Routes to CodeViewer, HtmlPreview, or ImageViewer
- Handles loading and error states
- Shows "Path Not Found" for invalid paths

---

#### `CodeViewer`

Displays code with syntax highlighting.

**Props:**

```typescript
interface CodeViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
  mimeType?: string;
}
```

**Features:**

- Shiki syntax highlighting (lazy loaded)
- Line numbers
- Copy button
- Word wrap toggle
- Download button
- Language auto-detection

**Performance:**

- Shiki loaded dynamically (reduces initial bundle)
- Memoized highlighting to prevent re-renders

---

#### `HtmlPreview`

Displays HTML in sandboxed iframe.

**Props:**

```typescript
interface HtmlPreviewProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
}
```

**Features:**

- Sandboxed iframe (`allow-scripts allow-same-origin allow-forms`)
- Loading state
- Refresh button
- Open in new tab button
- Error handling

**Security:**

- Sandbox restricts access to parent page
- Same-origin policy enforced

---

#### `ImageViewer`

Displays images with zoom and pan.

**Props:**

```typescript
interface ImageViewerProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath: string;
}
```

**Features:**

- Zoom controls (+/-)
- Pan with mouse drag (react-zoom-pan-pinch)
- Displays dimensions and file size
- Checkerboard background for transparency
- Error handling with retry

---

### Navigation Components

#### `RepoBreadcrumb`

Clickable breadcrumb navigation.

**Props:**

```typescript
interface RepoBreadcrumbProps {
  owner: string;
  repo: string;
  gitRef: string;
  filepath?: string;
}
```

**Features:**

- Clickable segments
- Mobile truncation
- Responsive design

---

#### `RefSelector`

Dropdown to select branch/commit/alias.

**Props:**

```typescript
interface RefSelectorProps {
  owner: string;
  repo: string;
  currentRef: string;
  currentPath?: string;
}
```

**Features:**

- Searchable dropdown (shadcn Command)
- Sections: Aliases, Branches, Recent Commits
- Icons for different ref types
- Preserves file path on switch

---

#### `BrowserTabs`

Tab navigation for Code/Preview/History.

**Props:**

```typescript
interface BrowserTabsProps {
  activeTab: 'code' | 'preview' | 'history';
  onTabChange: (tab: TabType) => void;
  showPreview: boolean;
  leftActions?: React.ReactNode;
}
```

**Features:**

- Keyboard shortcuts (Alt+C/P/H)
- URL-based tab state (`?tab=code`)
- Conditional preview tab (HTML only)

---

## API Integration

### RTK Query Setup

Base API configuration in `services/api.ts`:

```typescript
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const api = createApi({
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL || '/api',
    credentials: 'include', // Send cookies
  }),
  tagTypes: ['Files', 'Refs', 'Asset'],
  endpoints: () => ({}),
});
```

### Repository Endpoints

Defined in `services/repoApi.ts`:

#### `getFileTree`

Fetches list of files for a deployment.

**Endpoint:** `GET /api/repo/:owner/:repo/:commitSha/files`

**Query:**

```typescript
useGetFileTreeQuery({
  owner: 'testuser',
  repo: 'test-repo',
  commitSha: 'abc123def',
});
```

**Response:**

```typescript
interface FileTreeResponse {
  commitSha: string;
  repository: string;
  branch?: string;
  files: Array<{
    path: string;
    fileName: string;
    size: number;
    mimeType: string;
    isPublic: boolean;
    createdAt: string;
  }>;
}
```

---

#### `getRepositoryRefs`

Fetches aliases, branches, and recent commits.

**Endpoint:** `GET /api/repo/:owner/:repo/refs`

**Query:**

```typescript
useGetRepositoryRefsQuery({
  owner: 'testuser',
  repo: 'test-repo',
});
```

**Response:**

```typescript
interface RefsResponse {
  aliases: Array<{
    name: string;
    commitSha: string;
    updatedAt: string;
  }>;
  branches: Array<{
    name: string;
    latestCommit: string;
    latestDeployedAt: string;
    fileCount: number;
  }>;
  recentCommits: Array<{
    sha: string;
    shortSha: string;
    branch?: string;
    workflowName?: string;
    deployedAt: string;
  }>;
}
```

---

#### `downloadFile`

Downloads file content.

**Endpoint:** `GET /api/assets/download-by-path`

**Query:**

```typescript
useLazyDownloadFileQuery({
  repository: 'testuser/test-repo',
  ref: 'main',
  path: 'index.html',
});
```

**Response:** File content as text/binary

---

## Testing

### Unit Tests (Vitest + React Testing Library)

**Run tests:**

```bash
pnpm test              # Run with coverage
pnpm test:run          # Run without coverage
pnpm test:ui           # Open Vitest UI
```

**Coverage targets:**

- Overall: >80%
- Critical paths: >90%

**Test files:**

- `*.test.ts` - Pure logic tests
- `*.test.tsx` - Component tests

**Example:**

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileBrowserSidebar } from './FileBrowserSidebar';

test('should search files', async () => {
  render(<FileBrowserSidebar />);

  const searchInput = screen.getByPlaceholderText(/search/i);
  await userEvent.type(searchInput, 'index');

  expect(screen.getByText('index.html')).toBeInTheDocument();
});
```

---

### Integration Tests

Test multiple components working together.

**Location:** `src/test/integration/`

**Example:**

```typescript
test('should navigate from sidebar to file', () => {
  const store = createTestStore();

  // Simulate user workflow
  store.dispatch(setCurrentRepo({ owner: 'user', repo: 'repo' }));
  store.dispatch(setCurrentFilePath('index.html'));

  expect(store.getState().repo.currentFilePath).toBe('index.html');
});
```

---

### E2E Tests (Playwright)

Test full user flows in real browser.

**Run tests:**

```bash
pnpm test:e2e          # Run all E2E tests
pnpm test:e2e:ui       # Open Playwright UI
pnpm test:e2e:headed   # Run with browser visible
pnpm test:e2e:debug    # Debug mode
```

**Location:** `e2e/`

**Example:**

```typescript
test('should navigate through folders and view file', async ({ page }) => {
  await page.goto('/repo/testuser/test-repo/main');

  // Expand folder
  await page.click('[role="treeitem"]:has-text("src")');

  // Click file
  await page.click('[role="treeitem"]:has-text("index.html")');

  // Verify content visible
  await expect(page.locator('[data-testid="content-viewer"]')).toBeVisible();
});
```

---

## Development Workflow

### Setup

```bash
cd apps/frontend
pnpm install
```

### Development Server

```bash
pnpm dev
```

Runs on http://localhost:5173 with hot reload.

### Building

```bash
pnpm build
```

Output: `dist/` folder

### Linting

```bash
pnpm lint
```

### Formatting

```bash
pnpm format
```

### Type Checking

```bash
tsc --noEmit
```

---

## Performance Considerations

### Bundle Size

- **Main bundle**: ~172KB gzipped
- **Shiki**: Lazy-loaded dynamically (~200KB)
- **Code splitting**: Automatic via Vite

### Optimizations

1. **Lazy Loading**
   - Shiki loaded on first code view
   - Route-based code splitting

2. **Memoization**
   - File tree building memoized
   - Component renders optimized with React.memo

3. **Caching**
   - RTK Query caches API responses
   - File content cached in browser

4. **Virtualization** (future)
   - Large file trees (1000+ files) will use virtual scrolling

### Performance Budget

- Initial load: <2 seconds
- Time to interactive: <3 seconds
- File view: <500ms
- Syntax highlighting: <500ms

---

## Contributing

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Configured with React rules
- **Prettier**: Auto-formatting
- **Naming**: camelCase for variables, PascalCase for components

### Component Guidelines

1. **Single Responsibility**: One component, one job
2. **Prop Types**: Always use TypeScript interfaces
3. **Accessibility**: Include ARIA labels and keyboard support
4. **Testing**: Write tests for new components
5. **Documentation**: Add JSDoc comments for complex logic

### Git Workflow

1. Create feature branch: `feature/your-feature`
2. Make changes with clear commits
3. Write tests
4. Run linter and tests
5. Create pull request

### Pull Request Checklist

- [ ] Tests passing (unit + integration)
- [ ] Linter passing
- [ ] TypeScript compiles without errors
- [ ] No console errors/warnings
- [ ] Accessibility tested
- [ ] Mobile responsive
- [ ] Documentation updated

---

## Useful Resources

- [Redux Toolkit Docs](https://redux-toolkit.js.org/)
- [RTK Query Docs](https://redux-toolkit.js.org/rtk-query/overview)
- [React Router Docs](https://reactrouter.com/)
- [Tailwind CSS Docs](https://tailwindcss.com/)
- [shadcn/ui Docs](https://ui.shadcn.com/)
- [Shiki Docs](https://shiki.style/)
- [Playwright Docs](https://playwright.dev/)

---

## Troubleshooting

### Common Development Issues

**Vite proxy not working:**

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/public': 'http://localhost:3000',
  },
}
```

**TypeScript errors:**

```bash
# Clear cache and rebuild
rm -rf node_modules dist
pnpm install
pnpm build
```

**Tests failing:**

```bash
# Clear test cache
pnpm test:run --clearCache
```

---

**Questions?** Contact the development team or check the issue tracker.
