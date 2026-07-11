import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { EditRuleSetDialog } from './EditRuleSetDialog';
import { MANAGED_FROM_GIT_WARNING } from './ManagedFromGitBadge';
import { api } from '@/services/api';
import type { ProxyRuleSet } from '@/services/proxyRulesApi';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const baseRuleSet: ProxyRuleSet = {
  id: 'rs-1',
  projectId: 'proj-1',
  name: 'My API Rules',
  description: null,
  environment: null,
  source: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function renderDialog(ruleSet: ProxyRuleSet) {
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
  return render(
    <Provider store={store}>
      <EditRuleSetDialog ruleSet={ruleSet} open={true} onOpenChange={() => {}} />
    </Provider>,
  );
}

describe('EditRuleSetDialog managed-from-git warning', () => {
  it('shows an inline alert when the set is managed from git', () => {
    renderDialog({
      ...baseRuleSet,
      source: {
        repo: 'bffless/apps',
        gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        syncedAt: '2026-07-10T00:00:00.000Z',
        contentHash: 'sha256:deadbeef',
      },
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Managed from git')).toBeInTheDocument();
    expect(screen.getByText(MANAGED_FROM_GIT_WARNING)).toBeInTheDocument();
  });

  it('shows no alert for an unmanaged set', () => {
    renderDialog(baseRuleSet);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(MANAGED_FROM_GIT_WARNING)).not.toBeInTheDocument();
  });
});
