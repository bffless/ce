import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { ProxyRuleSetsPage } from './ProxyRuleSetsPage';
import { api } from '@/services/api';
import type { ProxyRuleSetExport } from '@/services/proxyRulesApi';

// Radix dropdown menus don't open reliably in happy-dom; render items inline
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

// The create/import dialogs have their own concerns; stub them out
vi.mock('@/components/proxy-rules/CreateRuleSetDialog', () => ({
  CreateRuleSetDialog: () => null,
}));
vi.mock('@/components/proxy-rules/ImportRuleSetDialog', () => ({
  ImportRuleSetDialog: () => null,
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock useProjectRole so the actions menu renders
vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({
    role: 'owner',
    isLoading: false,
    canEdit: true,
    canAdmin: true,
    isOwner: true,
  }),
}));

const project = { id: 'proj-1', owner: 'acme', name: 'site', defaultProxyRuleSetId: null };

const ruleSetsList = {
  ruleSets: [
    {
      id: 'rs-1',
      projectId: 'proj-1',
      name: 'My API Rules!',
      description: null,
      environment: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

// Canonical server envelope: the client must download this verbatim.
// exportedAt is server-stamped; headerConfig.add values arrive already blanked.
const serverEnvelope: ProxyRuleSetExport = {
  version: 2,
  exportedAt: '2026-07-11T12:34:56.000Z',
  kind: 'bffless-proxy-rule-set',
  ruleSet: { name: 'My API Rules!', description: 'demo rules' },
  rules: [
    {
      pathPattern: '/api/*',
      methods: ['GET', 'POST'],
      targetUrl: 'https://upstream.example',
      headerConfig: { add: { 'X-Api-Key': '' } },
    },
    { pathPattern: '/other/*', targetUrl: 'https://other.example' },
  ],
  schemas: [{ id: 'schema-1', name: 'comments', fields: [] }],
};

// The `schemas` key is omitted when no schemas are bundled; no secrets note
const envelopeNoSchemas: ProxyRuleSetExport = {
  version: 2,
  exportedAt: '2026-07-11T12:34:56.000Z',
  kind: 'bffless-proxy-rule-set',
  ruleSet: { name: 'My API Rules!' },
  rules: [{ pathPattern: '/api/*', targetUrl: 'https://upstream.example' }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });
}

function renderPage() {
  const store = createTestStore();
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/repo/acme/site/proxy-rules']}>
        <Routes>
          <Route path="/repo/:owner/:repo/proxy-rules" element={<ProxyRuleSetsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ProxyRuleSetsPage export', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exportEnvelope: ProxyRuleSetExport | null;
  let exportStatus: number;
  let createdBlobs: Blob[];
  let downloadNames: string[];

  beforeEach(() => {
    mockToast.mockClear();
    exportEnvelope = serverEnvelope;
    exportStatus = 200;
    createdBlobs = [];
    downloadNames = [];

    fetchMock = vi.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/projects/acme/site')) return jsonResponse(project);
      if (url.includes('/api/proxy-rule-sets/project/proj-1')) return jsonResponse(ruleSetsList);
      if (url.includes('/api/proxy-rule-sets/rs-1/export')) {
        return exportStatus === 200
          ? jsonResponse(exportEnvelope)
          : jsonResponse({ message: 'boom' }, exportStatus);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:mock-url';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadNames.push(this.download);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function clickExport() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Export' }));
  }

  it('downloads the server export envelope verbatim', async () => {
    await clickExport();

    await waitFor(() => expect(createdBlobs).toHaveLength(1));

    // Fetched from the export endpoint (not client-side assembly)
    const exportCall = fetchMock.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : (input as Request).url).includes(
        '/api/proxy-rule-sets/rs-1/export',
      ),
    );
    expect(exportCall).toBeDefined();

    // Payload is the server envelope, pretty-printed, byte-for-byte — no
    // re-ordering, no re-stamped exportedAt, no reshaping
    const downloaded = await createdBlobs[0].text();
    expect(downloaded).toBe(JSON.stringify(serverEnvelope, null, 2));
    expect(createdBlobs[0].type).toBe('application/json');

    // Filename derives from the envelope's rule set name via the safeName regex
    expect(downloadNames).toEqual(['My-API-Rules.proxy-rules.json']);
  });

  it('derives the toast counts and secrets note from the payload', async () => {
    await clickExport();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Rule set exported',
      description:
        'Exported "My API Rules!" with 2 rules and 1 schema.' +
        ' Added-header secret values were not included.',
    });
  });

  it('omits the schema count and secrets note when the payload has neither', async () => {
    exportEnvelope = envelopeNoSchemas;
    await clickExport();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Rule set exported',
      description: 'Exported "My API Rules!" with 1 rule.',
    });
  });

  it('shows a destructive toast when the export request fails', async () => {
    exportStatus = 500;
    await clickExport();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Export failed',
      description: 'Could not export the rule set. Please try again.',
      variant: 'destructive',
    });
    expect(createdBlobs).toHaveLength(0);
  });
});

describe('ProxyRuleSetsPage managed-from-git badge', () => {
  const managedSource = {
    repo: 'bffless/apps',
    path: 'apps/studio/proxy-rules',
    gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    syncedAt: '2026-07-10T00:00:00.000Z',
    contentHash: 'sha256:deadbeef',
  };

  let listBody: unknown;

  beforeEach(() => {
    mockToast.mockClear();
    listBody = ruleSetsList;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/api/projects/acme/site')) return jsonResponse(project);
        if (url.includes('/api/proxy-rule-sets/project/proj-1')) return jsonResponse(listBody);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the badge with repo@shortSha on sets that carry a source', async () => {
    listBody = {
      ruleSets: [
        { ...ruleSetsList.ruleSets[0], source: managedSource },
        {
          ...ruleSetsList.ruleSets[0],
          id: 'rs-2',
          name: 'Manual Rules',
          source: null,
        },
      ],
    };
    renderPage();

    expect(await screen.findByText('Managed from git')).toBeInTheDocument();
    expect(screen.getByText('bffless/apps@a1b2c3d')).toBeInTheDocument();
    // Only the managed set gets a badge
    expect(screen.getAllByText('Managed from git')).toHaveLength(1);
  });

  it('shows no badge when no set has a source', async () => {
    renderPage();

    expect(await screen.findByText('My API Rules!')).toBeInTheDocument();
    expect(screen.queryByText('Managed from git')).not.toBeInTheDocument();
  });
});
