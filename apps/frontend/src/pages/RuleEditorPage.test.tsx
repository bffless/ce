import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { RuleEditorPage } from './RuleEditorPage';
import { api } from '@/services/api';

// The full rule form has its own concerns; stub it with a submit button that
// exercises the page's save callback (the path that must warn on managed sets).
vi.mock('@/components/proxy-rules/ExpandedProxyRuleForm', () => ({
  ExpandedProxyRuleForm: ({
    onSubmit,
  }: {
    onSubmit: (data: unknown) => Promise<void>;
  }) => (
    <button onClick={() => void onSubmit({ pathPattern: '/api/*', order: 5 })}>
      stub-save-rule
    </button>
  ),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({
    role: 'owner',
    isLoading: false,
    canEdit: true,
    canAdmin: true,
    isOwner: true,
  }),
}));

const managedSource = {
  repo: 'bffless/apps',
  gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  syncedAt: '2026-07-10T00:00:00.000Z',
  contentHash: 'sha256:deadbeef',
};

function ruleSetBody(source: typeof managedSource | null) {
  return {
    id: 'rs-1',
    projectId: 'proj-1',
    name: 'My API Rules',
    description: null,
    environment: null,
    source,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    rules: [],
  };
}

const ruleBody = {
  id: 'rule-1',
  ruleSetId: 'rs-1',
  pathPattern: '/api/*',
  method: null,
  targetUrl: 'https://api.example.com',
  stripPrefix: true,
  order: 0,
  timeout: 30000,
  preserveHost: false,
  forwardCookies: false,
  headerConfig: null,
  authTransform: null,
  internalRewrite: false,
  proxyType: 'external_proxy',
  emailHandlerConfig: null,
  pipelineConfig: null,
  isEnabled: true,
  debugEnabled: false,
  description: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/repo/acme/site/proxy-rules/rs-1/rule-1']}>
        <Routes>
          <Route
            path="/repo/:owner/:repo/proxy-rules/:ruleSetId/:ruleId"
            element={<RuleEditorPage />}
          />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

const managedWarningCalls = () =>
  mockToast.mock.calls.filter(([args]) => args?.title === 'Managed from git');

describe('RuleEditorPage managed-from-git warning', () => {
  let setBody: ReturnType<typeof ruleSetBody>;

  beforeEach(() => {
    mockToast.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = typeof input === 'string' ? 'GET' : input.method;
        if (url.includes('/api/proxy-rules/rule-1') && method === 'PATCH') {
          return jsonResponse(ruleBody);
        }
        if (url.includes('/api/proxy-rules/rule-1')) return jsonResponse(ruleBody);
        if (url.includes('/api/proxy-rule-sets/rs-1')) return jsonResponse(setBody);
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warns once when saving a rule in a managed set (covers edits and order changes)', async () => {
    setBody = ruleSetBody(managedSource);
    renderPage();

    const save = await screen.findByText('stub-save-rule');
    await userEvent.click(save);
    await waitFor(() => expect(managedWarningCalls()).toHaveLength(1));

    // Second save on the same visit does not re-warn.
    await userEvent.click(save);
    await waitFor(() =>
      expect(mockToast.mock.calls.some(([args]) => args?.title === 'Rule updated')).toBe(true),
    );
    expect(managedWarningCalls()).toHaveLength(1);
  });

  it('does not warn when saving a rule in an unmanaged set', async () => {
    setBody = ruleSetBody(null);
    renderPage();

    await userEvent.click(await screen.findByText('stub-save-rule'));
    await waitFor(() =>
      expect(mockToast.mock.calls.some(([args]) => args?.title === 'Rule updated')).toBe(true),
    );
    expect(managedWarningCalls()).toHaveLength(0);
  });
});
