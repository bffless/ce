import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { RuleSetDetailPage } from './RuleSetDetailPage';
import { api } from '@/services/api';
import { MANAGED_FROM_GIT_WARNING } from '@/components/proxy-rules/ManagedFromGitBadge';

// The rules list has its own concerns (log counts, dialogs, switches); stub it
// with plain buttons that exercise the page's update/delete callbacks.
vi.mock('@/components/proxy-rules/RulesList', () => ({
  RulesList: ({
    onUpdateRule,
    onDeleteRule,
  }: {
    onUpdateRule: (id: string, updates: unknown) => Promise<void>;
    onDeleteRule: (id: string) => Promise<void>;
  }) => (
    <div>
      <button onClick={() => void onUpdateRule('rule-1', { isEnabled: false })}>
        stub-update-rule
      </button>
      <button onClick={() => void onDeleteRule('rule-1')}>stub-delete-rule</button>
    </div>
  ),
}));

// The set edit dialog carries its own inline managed-from-git alert,
// covered by its own test file.
vi.mock('@/components/proxy-rules/EditRuleSetDialog', () => ({
  EditRuleSetDialog: () => null,
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
  path: 'apps/studio/proxy-rules',
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
    environment: 'production',
    source,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    rules: [],
  };
}

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
      <MemoryRouter initialEntries={['/repo/acme/site/proxy-rules/rs-1']}>
        <Routes>
          <Route path="/repo/:owner/:repo/proxy-rules/:ruleSetId" element={<RuleSetDetailPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

const managedWarningCalls = () =>
  mockToast.mock.calls.filter(([args]) => args?.title === 'Managed from git');

describe('RuleSetDetailPage managed-from-git', () => {
  let setBody: ReturnType<typeof ruleSetBody>;

  beforeEach(() => {
    mockToast.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = typeof input === 'string' ? 'GET' : input.method;
        if (url.includes('/api/proxy-rule-sets/rs-1')) return jsonResponse(setBody);
        if (url.includes('/api/proxy-rules/rule-1') && method === 'PATCH') {
          return jsonResponse({ id: 'rule-1' });
        }
        if (url.includes('/api/proxy-rules/rule-1') && method === 'DELETE') {
          return jsonResponse({ success: true });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the banner in the header for a managed set', async () => {
    setBody = ruleSetBody(managedSource);
    renderPage();

    expect(await screen.findByText('Managed from git')).toBeInTheDocument();
    expect(screen.getByText('bffless/apps@a1b2c3d')).toBeInTheDocument();
  });

  it('shows no banner for an unmanaged set', async () => {
    setBody = ruleSetBody(null);
    renderPage();

    // Name renders in both the breadcrumb and the card title
    expect(await screen.findAllByText('My API Rules')).not.toHaveLength(0);
    expect(screen.queryByText('Managed from git')).not.toBeInTheDocument();
  });

  it('warns once per visit when mutating rules in a managed set', async () => {
    setBody = ruleSetBody(managedSource);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('stub-update-rule'));

    await waitFor(() => expect(managedWarningCalls()).toHaveLength(1));
    expect(managedWarningCalls()[0][0]).toEqual({
      title: 'Managed from git',
      description: MANAGED_FROM_GIT_WARNING,
    });

    // A second edit affordance in the same visit does not re-warn
    await user.click(screen.getByText('stub-delete-rule'));
    await waitFor(() =>
      expect(mockToast.mock.calls.some(([args]) => args?.title === 'Rule deleted')).toBe(true),
    );
    expect(managedWarningCalls()).toHaveLength(1);
  });

  it('warns when opening the Add Rule flow on a managed set', async () => {
    setBody = ruleSetBody(managedSource);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Add Rule/ }));

    expect(managedWarningCalls()).toHaveLength(1);
  });

  it('never warns for an unmanaged set', async () => {
    setBody = ruleSetBody(null);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('stub-update-rule'));
    await waitFor(() =>
      expect(mockToast.mock.calls.some(([args]) => args?.title === 'Rule updated')).toBe(true),
    );
    expect(managedWarningCalls()).toHaveLength(0);
  });
});
