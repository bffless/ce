# Contributing to Static Asset Hosting Platform

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/ce.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Follow the setup instructions in the README.md

## Development Workflow

1. Make your changes
2. Write or update tests as needed
3. Ensure all tests pass: `pnpm test`
4. Lint your code: `pnpm lint`
5. Format your code: `pnpm format`
6. Commit your changes with a descriptive message
7. Push to your fork
8. Create a Pull Request

## Code Style

- We use ESLint and Prettier for code formatting
- TypeScript strict mode is enabled
- Follow the existing code structure and patterns
- Write meaningful variable and function names
- Add comments for complex logic

## Commit Messages

Use clear and descriptive commit messages:

```
feat: add user authentication
fix: resolve asset upload bug
docs: update API documentation
refactor: simplify storage adapter interface
test: add tests for asset deletion
chore: update dependencies
```

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure CI/CD checks pass
4. Request review from maintainers
5. Address review feedback
6. Squash commits if requested

## Testing

- Write unit tests for new functions
- Add integration tests for API endpoints
- Test frontend components with user interactions
- Ensure edge cases are covered

## Questions?

Feel free to open an issue for questions or clarifications.

## Code of Conduct

Be respectful and constructive in all interactions.

