# Frontend Documentation

Comprehensive documentation for the BFFless frontend application.

## 📚 Available Guides

### [User Guide](./USER-GUIDE.md)

Complete guide for end users of the repository browser.

**Covers:**

- Getting started
- Navigating files and folders
- Viewing different file types
- Using the ref selector
- Searching files
- Keyboard shortcuts
- Mobile usage
- Troubleshooting

**Audience:** End users, content creators, developers viewing deployments

---

### [Developer Guide](./DEVELOPER-GUIDE.md)

Technical documentation for developers working on the frontend.

**Covers:**

- Architecture overview
- Technology stack
- Project structure
- State management (Redux + RTK Query)
- Component reference
- API integration
- Development workflow
- Performance considerations
- Contributing guidelines

**Audience:** Frontend developers, contributors, technical leads

---

### [Testing Guide](./TESTING-GUIDE.md)

Complete guide to testing the frontend application.

**Covers:**

- Testing philosophy
- Test types (unit, integration, E2E)
- Running tests
- Writing tests (with examples)
- Test coverage
- CI/CD integration
- Best practices
- Debugging

**Audience:** Developers writing or maintaining tests, QA engineers

---

## Quick Start

### For Users

Want to browse your deployed static sites? Start with the **[User Guide](./USER-GUIDE.md)**.

### For Developers

Setting up development environment or contributing? Check the **[Developer Guide](./DEVELOPER-GUIDE.md)**.

### For Testing

Writing or running tests? See the **[Testing Guide](./TESTING-GUIDE.md)**.

---

## Project Overview

The repository browser is a GitHub-style file browsing interface for viewing deployed static sites. It provides:

- **File tree navigation** with search
- **Content viewers** for code, HTML, images
- **Ref selector** to switch between branches/commits
- **Syntax highlighting** with Shiki
- **Responsive design** for desktop, tablet, and mobile
- **Dark mode** support

### Technology Stack

- **React 18** + **TypeScript 5**
- **Redux Toolkit** + **RTK Query**
- **React Router v6**
- **Tailwind CSS** + **shadcn/ui**
- **Vitest** + **Playwright**
- **Vite 5**

---

## Documentation Structure

```
docs/
├── README.md                # This file
├── USER-GUIDE.md           # For end users
├── DEVELOPER-GUIDE.md      # For developers
└── TESTING-GUIDE.md        # For testing
```

---

## Additional Resources

### Backend Documentation

- **[Backend API Docs](../../backend/src/repo-browser/)** - API endpoints and schemas
- **[Authentication Guide](../../backend/AUTH-ENDPOINTS-GUIDE.md)** - Auth flow and security

### Project Roadmap

- **[Phase 2 Roadmap](../../../roadmap/phase-2/ROADMAP.md)** - Repository browser implementation plan
- **[Phase 2 Requirements](../../../roadmap/phase-2/product-requirements.md)** - Detailed feature specifications

### Component Specs

- **[File Browser Sidebar](../../../roadmap/phase-2/01-file-browser-sidebar.md)**
- **[Content Viewer](../../../roadmap/phase-2/02-content-browser.md)**
- **[Page Layout & Routing](../../../roadmap/phase-2/03-page-layout-routing.md)**
- **[API Integration](../../../roadmap/phase-2/04-api-integration.md)**

---

## Test Coverage

Current test coverage (as of Phase 2H completion):

| Metric         | Coverage |
| -------------- | -------- |
| **Statements** | 85.07%   |
| **Branches**   | 82.74%   |
| **Functions**  | 87.17%   |
| **Lines**      | 85.71%   |

**Test Suites:**

- **Unit Tests**: 177 tests across 6 files
- **Integration Tests**: 15 tests for store workflows
- **E2E Tests**: 20+ tests for user flows (Playwright)

---

## Development Commands

```bash
# Development
pnpm dev                # Start dev server
pnpm build              # Build for production
pnpm preview            # Preview production build

# Testing
pnpm test               # Run unit + integration tests with coverage
pnpm test:ui            # Open Vitest UI
pnpm test:e2e           # Run E2E tests
pnpm test:e2e:ui        # Open Playwright UI

# Code Quality
pnpm lint               # Run ESLint
pnpm format             # Format with Prettier
tsc --noEmit            # Type check
```

---

## Feature Status

Phase 2 implementation status:

- ✅ **Phase 2A**: Backend APIs (file tree, refs)
- ✅ **Phase 2B**: Frontend setup (Redux, routing)
- ✅ **Phase 2C**: File browser sidebar
- ✅ **Phase 2D**: Content viewer (code, HTML, images)
- ✅ **Phase 2E**: Responsive layout
- ✅ **Phase 2F**: Ref selector
- ✅ **Phase 2G**: Polish & optimization
- ✅ **Phase 2H**: Testing & documentation

**Overall Progress: 100% Complete**

---

## Contributing

Interested in contributing? Please read:

1. **[Developer Guide](./DEVELOPER-GUIDE.md)** - Understand the architecture
2. **[Testing Guide](./TESTING-GUIDE.md)** - Learn to write tests
3. **[CONTRIBUTING.md](../../../CONTRIBUTING.md)** - Contribution guidelines

### Pull Request Checklist

Before submitting a PR:

- [ ] Tests passing (`pnpm test && pnpm test:e2e`)
- [ ] Linter passing (`pnpm lint`)
- [ ] TypeScript compiling (`tsc --noEmit`)
- [ ] Documentation updated
- [ ] Accessibility tested
- [ ] Mobile responsive

---

## Getting Help

### Documentation Issues

Found an issue with documentation? Please:

1. Check existing documentation
2. Search GitHub issues
3. Open a new issue with "docs:" prefix

### Technical Issues

Encountering bugs or technical problems?

1. Check the **[Troubleshooting](./USER-GUIDE.md#troubleshooting)** section
2. Review browser console for errors
3. Check GitHub issues
4. Open a new issue with reproduction steps

---

## Changelog

### Phase 2H (November 27, 2025)

- ✅ Added comprehensive unit tests (177 tests, 85.7% coverage)
- ✅ Added integration tests (15 tests)
- ✅ Set up Playwright E2E testing (20+ tests)
- ✅ Created user guide
- ✅ Created developer guide
- ✅ Created testing guide

### Phase 2G (November 27, 2025)

- ✅ Improved loading states with skeletons
- ✅ Enhanced error handling with retry buttons
- ✅ Added dark mode support
- ✅ Optimized performance (lazy-loaded Shiki)
- ✅ Improved accessibility (focus management, ARIA labels)

### Phase 2F (November 26, 2025)

- ✅ Built ref selector with search
- ✅ Implemented default ref resolution
- ✅ Added ref type icons
- ✅ File path preservation on ref switch

### Phase 2E (November 26, 2025)

- ✅ Responsive layout for desktop, tablet, mobile
- ✅ Resizable sidebar on desktop
- ✅ Sheet drawer for mobile
- ✅ Hamburger menu integration

### Phase 2D (November 25, 2025)

- ✅ Code viewer with Shiki syntax highlighting
- ✅ HTML preview with sandboxed iframe
- ✅ Image viewer with zoom/pan
- ✅ Breadcrumb navigation
- ✅ Tab navigation
- ✅ File actions toolbar

### Phase 2C (November 24, 2025)

- ✅ File browser sidebar with tree view
- ✅ File type icons (50+ mappings)
- ✅ Search functionality
- ✅ Keyboard navigation
- ✅ Comprehensive test coverage (40 tests)

### Phase 2B (November 23, 2025)

- ✅ Redux store setup
- ✅ RTK Query API integration
- ✅ React Router configuration
- ✅ Repository page layout

### Phase 2A (November 22, 2025)

- ✅ Backend API endpoints
- ✅ Database indexes
- ✅ Swagger documentation
- ✅ Unit and integration tests

---

## License

See [LICENSE](../../../LICENSE) for details.

---

**Last Updated:** November 27, 2025  
**Phase:** 2H (Testing & Documentation) - ✅ Complete
