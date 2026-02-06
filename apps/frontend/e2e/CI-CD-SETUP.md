# CI/CD Setup for E2E Tests

## Overview

Playwright E2E tests are now integrated into the GitHub Actions workflow and will automatically run on every push/PR. Test reports are uploaded to your asset host alongside coverage reports.

## What Was Configured

### 1. `.gitignore` Updates

The following directories are now ignored:

```gitignore
# Playwright test artifacts (generated locally and in CI)
apps/frontend/test-results/         # Test failure screenshots and traces
apps/frontend/playwright-report/    # HTML test report
apps/frontend/e2e/screenshots/*     # Screenshots from tests
!apps/frontend/e2e/screenshots/.gitkeep  # Keep directory structure
```

### 2. GitHub Workflow Updates

Updated `.github/workflows/test-and-coverage.yml` to include Playwright:

**New Steps:**

1. **Install Playwright browsers** - Installs only Chromium to save CI time
2. **Run Playwright tests** - Executes all 90 E2E tests with mocked APIs
3. **Generate HTML report** - Creates browsable test report
4. **Upload to asset host** - Deploys report alongside coverage

**Workflow Sequence:**

```
1. Install dependencies
2. Run unit tests → Generate coverage
3. Upload backend coverage
4. Upload frontend coverage
5. Install Playwright browsers (Chromium only) ← NEW
6. Run Playwright tests ← NEW
7. Upload Playwright report ← NEW
8. Summary
```

### 3. Asset Host Deployment

The Playwright report is uploaded as a ZIP file to your asset host with:

- **Repository**: `${{ github.repository }}`
- **Commit SHA**: `${{ github.sha }}`
- **Branch**: `${{ github.ref_name }}`
- **Alias**: `playwright-production` (when on main branch)
- **Public**: Yes (visible to all)

## Accessing Reports

### In CI

After a successful run, the GitHub Actions summary will show:

```
✅ Backend coverage uploaded
✅ Frontend coverage uploaded
✅ Playwright report uploaded
```

### On Asset Host

Reports are accessible at:

```
https://your-asset-host.com/repo/{owner}/{repo}/{sha}/
```

Example structure:
```
/repo/user/project/abc123def/
├── apps/backend/coverage/          # Backend coverage
├── apps/frontend/coverage/         # Frontend coverage
└── playwright-report/              # E2E test report
    ├── index.html                  # Main report page
    ├── data/                       # Test data
    └── trace/                      # Test traces
```

### Viewing Reports

1. **Navigate to your asset host** after CI completes
2. **Browse to the commit SHA** directory
3. **Click on `playwright-report/index.html`**
4. **View**:
   - Test pass/fail status
   - Test duration
   - Screenshots on failure
   - Execution traces
   - Browser console logs

## Local Development

### Run Tests Locally

```bash
# Run all tests
pnpm playwright test

# Run specific browser
pnpm playwright test --project=chromium

# Run with UI (interactive)
pnpm playwright test --ui

# Generate and view report
pnpm playwright show-report
```

### Generated Files (Local)

When you run tests locally, these directories are created:

- `test-results/` - Failure artifacts (screenshots, traces)
- `playwright-report/` - HTML report
- `e2e/screenshots/` - Screenshots from tests

**Note**: All ignored by git, won't be committed.

## CI Optimizations

### Why Only Chromium in CI?

**CI Configuration:**
```yaml
# Install only Chromium
run: pnpm exec playwright install --with-deps chromium

# Run only Chromium tests
run: pnpm --filter frontend playwright test --project=chromium
```

**Rationale:**
- **Faster CI** - Installing all browsers takes ~2-3 minutes extra
- **Lower costs** - 18 tests instead of 90 tests (5x faster)
- **Sufficient coverage** - Chromium covers most compatibility issues
- **Mocked APIs** - Tests run independently, minimal browser differences

### Local Browser Testing

**Locally, all browsers are available:**

```bash
# Run all browsers (90 tests across 5 browsers)
pnpm playwright test

# Run specific browser
pnpm playwright test --project=chromium
pnpm playwright test --project=firefox
pnpm playwright test --project=webkit

# Run specific browser group
pnpm playwright test --project="Mobile Chrome"
pnpm playwright test --project="Mobile Safari"
```

**Configured browsers:**
- ✅ Desktop Chrome (Chromium)
- ✅ Desktop Firefox
- ✅ Desktop Safari (WebKit)
- ✅ Mobile Chrome (Pixel 5)
- ✅ Mobile Safari (iPhone 12)

**All 18 test scenarios × 5 browsers = 90 tests locally**
**CI runs: 18 tests × 1 browser (Chromium) = 18 tests**

## Report Contents

The Playwright HTML report includes:

### Overview Page
- Total tests run
- Pass/fail rate
- Duration
- Browser breakdown

### Test Details
- Step-by-step execution
- Timing for each step
- Console logs
- Network requests (when captured)

### Failures
- Screenshot at point of failure
- Full execution trace
- Error stack trace
- Context about what went wrong

### Traces
- Interactive timeline
- DOM snapshots at each step
- Network activity
- Console output
- Can replay test execution

## Workflow Failure Handling

If Playwright tests fail:

1. **CI will fail** - `continue-on-error: false`
2. **Report still uploaded** - Even on failure
3. **View report** to see what failed
4. **Check traces** for detailed debugging

## Benefits

✅ **Automated E2E testing** on every PR/push
✅ **No backend required** - All APIs mocked
✅ **Fast execution** - 90 tests in ~18 seconds
✅ **Visual reports** - See exactly what happened
✅ **Trace debugging** - Replay failed tests
✅ **Historical tracking** - Every commit has a report
✅ **Public access** - Anyone can view results

## Troubleshooting

### Tests Pass Locally But Fail in CI

- **Viewport differences** - CI uses standard sizes
- **Timing issues** - CI may be slower, add waits
- **Screenshot differences** - Font rendering varies

### Report Not Uploaded

Check:
1. Tests generated `playwright-report/` directory
2. `ASSET_HOST_URL` and `ASSET_HOST_KEY` secrets configured
3. Asset host is accessible from GitHub Actions

### Large Report Size

The report includes:
- Screenshots on failure
- Full traces
- Network data

Limit by:
- Only taking screenshots on failure (default)
- Reducing trace capture
- Compressing images
