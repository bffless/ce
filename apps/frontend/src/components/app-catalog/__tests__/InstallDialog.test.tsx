import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { InstallDialog } from '../InstallDialog';
import type {
  CatalogEntry,
  InstallJob,
  PreflightResponse,
} from '@/services/appCatalogApi';

const preflightTrigger = vi.fn();
const installTrigger = vi.fn();
const undoTrigger = vi.fn();
const ackTrigger = vi.fn();

let preflightState: { data?: PreflightResponse; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
let installState: { isLoading: boolean } = { isLoading: false };
let jobQueryResult: { data?: InstallJob } = { data: undefined };
let undoState: { isLoading: boolean } = { isLoading: false };
let ackState: { isLoading: boolean } = { isLoading: false };

vi.mock('@/services/appCatalogApi', () => ({
  usePreflightAppMutation: () => [preflightTrigger, preflightState],
  useInstallAppMutation: () => [installTrigger, installState],
  useGetInstallJobQuery: () => jobQueryResult,
  useUndoJobMutation: () => [undoTrigger, undoState],
  useAckManualStepMutation: () => [ackTrigger, ackState],
}));

vi.mock('@/services/repositoriesApi', () => ({
  useGetMyRepositoriesQuery: () => ({
    data: {
      total: 1,
      repositories: [
        { id: 'proj-1', owner: 'acme', name: 'handoff-site', permissionType: 'owner', role: 'admin' },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const baseEntry: CatalogEntry = {
  id: 'handoff',
  name: 'Handoff',
  summary: 'Share files with clients',
  gates: [],
  installable: true,
};

function makePreflight(overrides: Partial<PreflightResponse> = {}): PreflightResponse {
  return {
    gates: [{ id: 'storage', status: 'pass', message: 'Storage looks good' }],
    syncPlans: [
      {
        ruleSet: 'handoff-api',
        created: 2,
        updated: 0,
        unchanged: 1,
        pruneCandidates: 0,
        schemaResolutions: [{ name: 'files', action: 'create', fieldMismatch: false }],
      },
    ],
    appHost: 'handoff.example.com',
    appUrl: 'https://handoff.example.com',
    ...overrides,
  };
}

function makeJob(overrides: Partial<InstallJob> = {}): InstallJob {
  return {
    id: 'job-1',
    kind: 'install',
    appId: 'handoff',
    projectId: 'proj-1',
    status: 'running',
    steps: [
      { id: 'preflight', status: 'done' },
      { id: 'fetch', status: 'done' },
      { id: 'sync-rules', status: 'running' },
      { id: 'deploy', status: 'pending' },
    ],
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  preflightTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve(makePreflight()) });
  installTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
  undoTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({}) });
  ackTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ acked: [] }) });
  preflightState = { data: makePreflight(), isLoading: false };
  installState = { isLoading: false };
  jobQueryResult = { data: undefined };
  undoState = { isLoading: false };
  ackState = { isLoading: false };
});

describe('InstallDialog — Review screen', () => {
  it('renders the per-rule-set plan language', () => {
    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('2 rules created · 0 updated')).toBeInTheDocument();
  });

  it('renders the aggregated data tables summary', () => {
    preflightState = {
      data: makePreflight({
        syncPlans: [
          {
            ruleSet: 'handoff-api',
            created: 1,
            updated: 0,
            unchanged: 0,
            pruneCandidates: 0,
            schemaResolutions: [
              { name: 'files', action: 'create', fieldMismatch: false },
              { name: 'shares', action: 'reuse', fieldMismatch: false },
            ],
          },
        ],
      }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('2 data tables: 1 reused, 1 created')).toBeInTheDocument();
  });

  it('renders a warning row for schema resolutions with a field mismatch', () => {
    preflightState = {
      data: makePreflight({
        syncPlans: [
          {
            ruleSet: 'handoff-api',
            created: 0,
            updated: 1,
            unchanged: 0,
            pruneCandidates: 0,
            schemaResolutions: [{ name: 'shares', action: 'reuse', fieldMismatch: true }],
          },
        ],
      }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText(/shares/)).toBeInTheDocument();
    expect(screen.getByText(/field mismatch/i)).toBeInTheDocument();
  });

  it('disables Install when a gate has failed', () => {
    preflightState = {
      data: makePreflight({
        gates: [
          { id: 'storage', status: 'pass', message: 'Storage looks good' },
          {
            id: 'dns',
            status: 'fail',
            message: 'DNS record missing',
            remediation: 'Add the CNAME record shown below.',
            retryable: true,
          },
        ],
      }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('DNS record missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('enables Install when every gate passes', () => {
    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^install$/i })).toBeEnabled();
  });

  it('shows the "Why?" remediation for a failed gate', () => {
    preflightState = {
      data: makePreflight({
        gates: [
          {
            id: 'dns',
            status: 'fail',
            message: 'DNS record missing',
            remediation: 'Add the CNAME record shown below.',
            deepLink: '/admin/settings/domains',
          },
        ],
      }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /why\?/i }));
    expect(screen.getByText('Add the CNAME record shown below.')).toBeInTheDocument();
  });

  it('preselects the project when exactly one exists and shows a "Create new project" option', () => {
    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    const select = screen.getByRole('combobox', { name: /project/i }) as HTMLSelectElement;
    expect(select.value).toBe('proj-1');
    expect(within(select).getByText(/create new project/i)).toBeInTheDocument();
  });

  it('shows owner/name inputs and the immutability warning when creating a new project', () => {
    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    const select = screen.getByRole('combobox', { name: /project/i });
    fireEvent.change(select, { target: { value: 'new' } });

    expect(screen.getByLabelText(/owner/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(
      screen.getByText("A project's owner/name can never be renamed."),
    ).toBeInTheDocument();
  });
});

describe('InstallDialog — Working screen', () => {
  it('renders step statuses from the polled job', async () => {
    jobQueryResult = { data: makeJob() };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(await screen.findByText(/fetch app bundle/i)).toBeInTheDocument();
    expect(screen.getByText(/sync proxy rules/i)).toBeInTheDocument();
    expect(screen.getByText(/^deploy$/i)).toBeInTheDocument();
  });

  it('shows the detail text for an action-required step', async () => {
    jobQueryResult = {
      data: makeJob({
        steps: [
          {
            id: 'domain',
            status: 'action-required',
            detail: 'Add a CNAME record for handoff.example.com pointing to app.bffless.dev',
          },
        ],
      }),
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(
      await screen.findByText(/Add a CNAME record for handoff\.example\.com/i),
    ).toBeInTheDocument();
  });

  it('offers Undo and Close when the job fails', async () => {
    jobQueryResult = {
      data: makeJob({ status: 'failed', error: 'Deploy step failed: timed out' }),
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(await screen.findByText('Deploy step failed: timed out')).toBeInTheDocument();
    const undoButton = screen.getByRole('button', { name: /undo this install/i });
    expect(undoButton).toBeInTheDocument();
    const footer = undoButton.parentElement as HTMLElement;
    expect(within(footer).getByRole('button', { name: /^close$/i })).toBeInTheDocument();

    fireEvent.click(undoButton);
    expect(undoTrigger).toHaveBeenCalledWith('job-1');
  });
});

describe('InstallDialog — Done screen', () => {
  it('renders the app URL, an Open link, and the manual steps checklist, firing ack on check', async () => {
    jobQueryResult = {
      data: makeJob({
        status: 'succeeded',
        installedAppId: 'installed-1',
        appUrl: 'https://handoff.example.com',
        manualSteps: [
          {
            id: 'set-env',
            title: 'Set the SIGNING_SECRET',
            body: 'Add SIGNING_SECRET to your environment before sharing links.',
          },
        ],
      }),
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    const openLink = await screen.findByRole('link', { name: /open/i });
    expect(openLink).toHaveAttribute('href', 'https://handoff.example.com');

    expect(screen.getByText('Set the SIGNING_SECRET')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /set the signing_secret/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(ackTrigger).toHaveBeenCalledWith({ id: 'installed-1', stepId: 'set-env' });
  });

  it('prefers the durable entry.installed manual-step ack state over the job', async () => {
    const entryWithInstall: CatalogEntry = {
      ...baseEntry,
      installed: {
        installedAppId: 'installed-1',
        version: '1.0.0',
        projectId: 'proj-1',
        projectName: 'acme/handoff-site',
        alias: 'production',
        appUrl: 'https://handoff.example.com',
        status: 'installed',
        updateAvailable: false,
        manualSteps: [
          { id: 'set-env', title: 'Set the SIGNING_SECRET', body: 'Add it before sharing links.' },
        ],
        manualStepsAcked: ['set-env'],
      },
    };
    jobQueryResult = {
      data: makeJob({ status: 'succeeded', installedAppId: 'installed-1' }),
    };

    render(<InstallDialog entry={entryWithInstall} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    const checkbox = await screen.findByRole('checkbox', { name: /set the signing_secret/i });
    expect(checkbox).toBeChecked();
  });
});
