import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { EjectPanel } from '../EjectPanel';
import type { CatalogEntry, EjectPayload } from '@/services/appCatalogApi';
import type { CreateApiKeyResponse } from '@/services/apiKeysApi';

const getEjectPayloadQueryMock = vi.fn<
  (id: string, options?: { skip?: boolean }) => { data?: EjectPayload; isFetching: boolean }
>(() => ejectState);
const createApiKeyTrigger = vi.fn();

let ejectState: { data?: EjectPayload; isFetching: boolean } = { data: undefined, isFetching: false };
let createApiKeyState: { isLoading: boolean } = { isLoading: false };
const toastMock = vi.fn();

vi.mock('@/services/appCatalogApi', () => ({
  useGetEjectPayloadQuery: (id: string, options?: { skip?: boolean }) =>
    getEjectPayloadQueryMock(id, options),
}));

vi.mock('@/services/apiKeysApi', () => ({
  useCreateApiKeyMutation: () => [createApiKeyTrigger, createApiKeyState],
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
});

const entry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  gates: [],
  installable: true,
  installed: {
    installedAppId: 'installed-1',
    version: '1.2.0',
    projectId: 'proj-1',
    projectName: 'acme/handoff',
    alias: 'production',
    appUrl: 'https://handoff.example.com',
    status: 'installed',
    updateAvailable: false,
    manualSteps: [],
  },
};

function makePayload(overrides: Partial<EjectPayload> = {}): EjectPayload {
  return {
    repo: 'bffless/handoff',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    forkUrl: 'https://github.com/bffless/handoff/fork',
    variables: {
      BFFLESS_URL: 'https://admin.example.com',
      BFFLESS_PROJECT: 'acme/handoff',
    },
    secrets: ['BFFLESS_API_KEY'],
    alias: 'production',
    note: "The workflow's first deploy lands on this same alias.",
    ...overrides,
  };
}

beforeEach(() => {
  getEjectPayloadQueryMock.mockClear();
  ejectState = { data: makePayload(), isFetching: false };
  createApiKeyState = { isLoading: false };
  toastMock.mockReset();
  createApiKeyTrigger.mockReset();
});

describe('EjectPanel', () => {
  it('renders the fork link and Actions variables with copy buttons', () => {
    render(<EjectPanel entry={entry} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('link', { name: /fork on github/i })).toHaveAttribute(
      'href',
      'https://github.com/bffless/handoff/fork',
    );
    expect(screen.getByText('BFFLESS_URL')).toBeInTheDocument();
    expect(screen.getByText('https://admin.example.com')).toBeInTheDocument();
    expect(screen.getByText('BFFLESS_PROJECT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy bffless_url/i })).toBeInTheDocument();
  });

  it('renders the secrets list with an inline Mint API key button', () => {
    render(<EjectPanel entry={entry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('BFFLESS_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mint api key/i })).toBeInTheDocument();
  });

  it('mints an API key scoped to the app project when clicked', async () => {
    const response: CreateApiKeyResponse = {
      message: 'ok',
      data: { id: 'key-1', name: 'x', projectId: 'proj-1', expiresAt: null, createdAt: '2026-07-30' },
      key: 'bffless_sk_abc123',
    };
    createApiKeyTrigger.mockReturnValue({ unwrap: () => Promise.resolve(response) });

    render(<EjectPanel entry={entry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /mint api key/i }));

    expect(createApiKeyTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'acme/handoff' }),
    );
    expect(await screen.findByText('bffless_sk_abc123')).toBeInTheDocument();
  });

  it('renders the workflow name to run', () => {
    render(<EjectPanel entry={entry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('deploy-handoff.yml')).toBeInTheDocument();
  });

  it('renders the continuity note verbatim', () => {
    render(<EjectPanel entry={entry} open onOpenChange={vi.fn()} />);

    expect(
      screen.getByText(
        "The workflow's first deploy lands on this same alias — your install becomes the fork's deploy target.",
      ),
    ).toBeInTheDocument();
  });
});
