import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { InstallDialog } from '../InstallDialog';
import { api } from '@/services/api';
import type {
  CatalogEntry,
  InstallJob,
  PreflightResponse,
} from '@/services/appCatalogApi';

const preflightTrigger = vi.fn();
const resetPreflightMock = vi.fn();
const installTrigger = vi.fn();
const undoTrigger = vi.fn();
const getInstallJobQueryMock = vi.fn<
  (jobId: string, options?: { pollingInterval?: number; skip?: boolean }) => { data?: InstallJob }
>(() => jobQueryResult);

let preflightState: { data?: PreflightResponse; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
let installState: { isLoading: boolean } = { isLoading: false };
let jobQueryResult: { data?: InstallJob } = { data: undefined };
let undoState: { isLoading: boolean } = { isLoading: false };

vi.mock('@/services/appCatalogApi', () => ({
  usePreflightAppMutation: () => [
    preflightTrigger,
    { ...preflightState, reset: resetPreflightMock },
  ],
  useInstallAppMutation: () => [installTrigger, installState],
  useGetInstallJobQuery: (
    jobId: string,
    options?: { pollingInterval?: number; skip?: boolean },
  ) => getInstallJobQueryMock(jobId, options),
  useUndoJobMutation: () => [undoTrigger, undoState],
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

const dispatchMock = vi.fn();

vi.mock('@/store/hooks', () => ({
  useAppDispatch: () => dispatchMock,
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
  resetPreflightMock.mockReset();
  installTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ jobId: 'job-1' }) });
  undoTrigger.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({}) });
  getInstallJobQueryMock.mockClear();
  dispatchMock.mockClear();
  preflightState = { data: makePreflight(), isLoading: false };
  installState = { isLoading: false };
  jobQueryResult = { data: undefined };
  undoState = { isLoading: false };
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

  // ce#584: a direct-serving instance with no wildcard certificate cannot serve
  // the app over HTTPS at all. Rather than deploy an app to a plain-HTTP
  // origin, the install is blocked until a wildcard exists.
  it('blocks Install when the app host could only be served over http://', () => {
    preflightState = {
      data: makePreflight({
        gates: [
          { id: 'storage', status: 'pass', message: 'Storage looks good' },
          {
            id: 'app-host-tls',
            status: 'fail',
            message: 'handoff.example.com could only be served over http:// — no wildcard certificate yet.',
            remediation: 'Provision a wildcard certificate on the Domains page.',
            deepLink: '/domains',
            retryable: true,
          },
        ],
      }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(
      screen.getByText(/could only be served over http:\/\/ — no wildcard certificate yet\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install$/i })).toBeDisabled();
    // retryable: provisioning a wildcard is minutes away, so offer the re-check
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /why\?/i }));
    expect(screen.getByText('Provision a wildcard certificate on the Domains page.')).toBeInTheDocument();
  });

  it('enables Install when every gate passes', () => {
    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^install$/i })).toBeEnabled();
  });

  it('disables Install while a new preflight is in flight, even against clean stale data from the previous selection', () => {
    // RTK Query mutation hooks keep the previous `data` around until the new
    // request settles — `isLoading` flips to true well before `data` is
    // replaced. Reproduce that: the still-clean, all-pass preflight from the
    // prior selection is still sitting in `data` while a new one is pending.
    preflightState = { data: makePreflight(), isLoading: true };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^install$/i })).toBeDisabled();
  });

  it('resets the preflight result immediately on selection change, debouncing the re-fire', () => {
    vi.useFakeTimers();
    try {
      render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

      // The initial mount already ran a preflight for the preselected project;
      // isolate the assertion to the effect of the selection actually changing.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      resetPreflightMock.mockClear();
      preflightTrigger.mockClear();

      fireEvent.change(screen.getByRole('combobox', { name: /project/i }), {
        target: { value: 'new' },
      });
      fireEvent.change(screen.getByLabelText(/owner/i), { target: { value: 'acme' } });
      fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'new-site' } });

      // The reset (which clears stale `preflightData`, so `canInstall` is
      // false) is synchronous — it must not wait for the debounce.
      expect(resetPreflightMock).toHaveBeenCalled();
      // But the actual network re-fire is debounced — not yet.
      expect(preflightTrigger).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(preflightTrigger).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it('shows the subdomain field empty, placeholder-defaulted from the first preflight appHost', () => {
    preflightState = { data: makePreflight({ appHost: 'handoff.example.com' }), isLoading: false };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    const input = screen.getByLabelText(/subdomain/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('handoff');
  });

  it('shows the resulting URL from the preflight response next to the subdomain field', () => {
    preflightState = {
      data: makePreflight({ appHost: 'handoff.example.com', appUrl: 'https://handoff.example.com' }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('https://handoff.example.com')).toBeInTheDocument();
  });

  it('debounces the subdomain field: resets immediately, re-fires preflight only after the delay, with subdomain in the body', () => {
    vi.useFakeTimers();
    try {
      render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      resetPreflightMock.mockClear();
      preflightTrigger.mockClear();

      fireEvent.change(screen.getByLabelText(/subdomain/i), { target: { value: 'my-app' } });

      expect(resetPreflightMock).toHaveBeenCalled();
      expect(preflightTrigger).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(preflightTrigger).toHaveBeenCalledTimes(1);
      expect(preflightTrigger).toHaveBeenCalledWith({
        appId: 'handoff',
        body: { projectId: 'proj-1', subdomain: 'my-app' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits subdomain from the preflight body when the field is left empty', () => {
    vi.useFakeTimers();
    try {
      render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(preflightTrigger).toHaveBeenCalledWith({
        appId: 'handoff',
        body: { projectId: 'proj-1' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Install disabled for the whole debounce window after a subdomain keystroke', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      // Mount's own preflight settles against the seeded `preflightState`
      // (untouched so far); Install starts enabled.
      expect(screen.getByRole('button', { name: /^install$/i })).toBeEnabled();

      // From here on, mirror the real RTK Query mutation: reset() clears
      // `data`, which is exactly what makes `canInstall` false — the mocked
      // hook otherwise has no reactivity of its own to observe.
      resetPreflightMock.mockImplementation(() => {
        preflightState = { ...preflightState, data: undefined };
      });
      preflightTrigger.mockClear();

      fireEvent.change(screen.getByLabelText(/subdomain/i), { target: { value: 'my-app' } });
      rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

      expect(screen.getByRole('button', { name: /^install$/i })).toBeDisabled();
      expect(preflightTrigger).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(preflightTrigger).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the same subdomain the last preflight showed when installing', async () => {
    preflightState = {
      data: makePreflight({ appHost: 'my-app.example.com', appUrl: 'https://my-app.example.com' }),
      isLoading: false,
    };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/subdomain/i), { target: { value: 'my-app' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    });

    expect(installTrigger).toHaveBeenCalledWith({
      appId: 'handoff',
      body: { projectId: 'proj-1', subdomain: 'my-app' },
    });
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

  it('keeps polling (pollingInterval 1000) while the job is still running', async () => {
    jobQueryResult = { data: makeJob({ status: 'running' }) };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await screen.findByText(/sync proxy rules/i);

    const lastCall = getInstallJobQueryMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ pollingInterval: 1000, skip: false });
  });

  it('stops polling (pollingInterval 0) once the job reaches a terminal status', async () => {
    jobQueryResult = { data: makeJob({ status: 'succeeded', appUrl: 'https://handoff.example.com' }) };

    render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await screen.findByRole('link', { name: /open/i });

    const lastCall = getInstallJobQueryMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({ pollingInterval: 0 });
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
  it('renders the app URL, an Open link, and the setup notes expanded', async () => {
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

    // The Done screen passes `defaultExpanded`, so the body is visible
    // without a click.
    expect(screen.getByText('Set the SIGNING_SECRET')).toBeInTheDocument();
    expect(
      screen.getByText('Add SIGNING_SECRET to your environment before sharing links.'),
    ).toBeInTheDocument();
  });

  it('prefers the durable entry.installed manual steps over the job’s', async () => {
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
          { id: 'installed-step', title: 'Rotate the signing secret', body: 'Do it in Settings.' },
        ],
      },
    };
    jobQueryResult = {
      data: makeJob({
        status: 'succeeded',
        installedAppId: 'installed-1',
        manualSteps: [{ id: 'job-step', title: 'Set the SIGNING_SECRET', body: 'From the job.' }],
      }),
    };

    render(<InstallDialog entry={entryWithInstall} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(await screen.findByText('Rotate the signing secret')).toBeInTheDocument();
    expect(screen.queryByText('Set the SIGNING_SECRET')).not.toBeInTheDocument();
  });
});

describe('InstallDialog — update mode reuse', () => {
  it('skips the Review screen and goes straight to Working when opened with an initialJobId', () => {
    jobQueryResult = { data: makeJob({ kind: 'update', status: 'running' }) };

    render(
      <InstallDialog
        entry={baseEntry}
        open
        onOpenChange={vi.fn()}
        mode="update"
        initialJobId="job-1"
      />,
    );

    expect(screen.getByText(/sync proxy rules/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /project/i })).not.toBeInTheDocument();
    expect(screen.getByText(`Updating ${baseEntry.name}`)).toBeInTheDocument();
  });

  it('offers Close but never Undo when a failed job is an update', () => {
    // Undo tears down the whole install from its cumulative createdResources
    // — data tables included — so it must not be one click away from a failed
    // update. The alias's deployment history is the rollback path instead.
    jobQueryResult = {
      data: makeJob({ kind: 'update', status: 'failed', error: 'Fetch failed: socket hang up' }),
    };

    render(
      <InstallDialog
        entry={baseEntry}
        open
        onOpenChange={vi.fn()}
        mode="update"
        initialJobId="job-1"
      />,
    );

    expect(screen.getByText('Fetch failed: socket hang up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    // The dialog chrome's own X also exposes an accessible name of "Close" —
    // the footer button is the one without the sr-only label.
    const footerClose = screen
      .getAllByRole('button', { name: /^close$/i })
      .find((button) => !button.querySelector('.sr-only'));
    expect(footerClose).toBeDefined();
    expect(screen.getByText(/nothing was removed/i)).toBeInTheDocument();
    expect(undoTrigger).not.toHaveBeenCalled();
  });

  it('shows the "updated" title on the Done screen', () => {
    jobQueryResult = {
      data: makeJob({ kind: 'update', status: 'succeeded', appUrl: 'https://handoff.example.com' }),
    };

    render(
      <InstallDialog
        entry={baseEntry}
        open
        onOpenChange={vi.fn()}
        mode="update"
        initialJobId="job-1"
      />,
    );

    expect(screen.getByText(`${baseEntry.name} updated`)).toBeInTheDocument();
  });
});

describe('InstallDialog — catalog cache invalidation on job completion', () => {
  // Regression coverage for the live-test bug: installApp/updateApp
  // invalidate ['AppCatalog', 'InstalledApp'] at DISPATCH time, before the
  // background job has done anything, so the catalog card is stuck showing
  // pre-update state until a manual reload. The dialog must invalidate again
  // itself, once, the moment its polling observes a terminal job status.

  it('dispatches invalidateTags exactly once when the job transitions running -> succeeded', async () => {
    jobQueryResult = { data: makeJob({ status: 'running' }) };
    const { rerender } = render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    await screen.findByText(/sync proxy rules/i);
    expect(dispatchMock).not.toHaveBeenCalled();

    jobQueryResult = {
      data: makeJob({ status: 'succeeded', appUrl: 'https://handoff.example.com' }),
    };
    rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    await screen.findByRole('link', { name: /open/i });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      api.util.invalidateTags(['AppCatalog', 'InstalledApp']),
    );
  });

  it('does not dispatch invalidateTags again across further re-renders while the job stays terminal', async () => {
    jobQueryResult = {
      data: makeJob({ status: 'succeeded', appUrl: 'https://handoff.example.com' }),
    };
    const { rerender } = render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    await screen.findByRole('link', { name: /open/i });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    dispatchMock.mockClear();

    // Further poll ticks / re-renders that keep observing the same terminal
    // job (still status 'succeeded', same job id) must not invalidate again.
    rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("dispatches invalidateTags once when the job transitions to 'undone'", async () => {
    jobQueryResult = { data: makeJob({ status: 'running' }) };
    const { rerender } = render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    await screen.findByText(/sync proxy rules/i);
    expect(dispatchMock).not.toHaveBeenCalled();

    jobQueryResult = { data: makeJob({ status: 'undone' }) };
    rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      api.util.invalidateTags(['AppCatalog', 'InstalledApp']),
    );
  });

  it('never dispatches invalidateTags while the job stays running', async () => {
    jobQueryResult = { data: makeJob({ status: 'running' }) };
    const { rerender } = render(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));
    await screen.findByText(/sync proxy rules/i);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Simulate more poll ticks — still running, just further along.
    jobQueryResult = {
      data: makeJob({
        status: 'running',
        steps: [
          { id: 'preflight', status: 'done' },
          { id: 'fetch', status: 'done' },
          { id: 'sync-rules', status: 'done' },
          { id: 'deploy', status: 'running' },
        ],
      }),
    };
    rerender(<InstallDialog entry={baseEntry} open onOpenChange={vi.fn()} />);
    await screen.findByText(/^deploy$/i);

    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
