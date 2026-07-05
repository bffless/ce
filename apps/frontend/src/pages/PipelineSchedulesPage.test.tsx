import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PipelineSchedulesPage } from './PipelineSchedulesPage';
import type { PipelineSchedule } from '@/services/pipelineSchedulesApi';

const mockGetSchedules = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ owner: 'acme', repo: 'site' }) };
});

vi.mock('@/services/projectsApi', () => ({
  useGetProjectQuery: () => ({ data: { id: 'proj-1' }, isLoading: false }),
}));

vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true }),
}));

vi.mock('@/services/pipelineSchedulesApi', () => ({
  useGetSchedulesQuery: (_arg: unknown, opts: { skip?: boolean }) => mockGetSchedules(opts),
  useUpdateScheduleMutation: () => [mockUpdate, { isLoading: false }],
  useDeleteScheduleMutation: () => [mockDelete, { isLoading: false }],
  // getPipelineRuleOptions is used by the dialog, which is only rendered lazily;
  // provide a stub so the import resolves.
  useGetPipelineRuleOptionsQuery: () => ({ data: [], isLoading: false }),
  useCreateScheduleMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const schedule = (o: Partial<PipelineSchedule> = {}): PipelineSchedule => ({
  id: 'sched-1',
  projectId: 'proj-1',
  name: 'Refresh feeds',
  targetProxyRuleId: 'rule-1',
  cronExpression: '*/15 * * * *',
  timezone: 'UTC',
  enabled: true,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...o,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PipelineSchedulesPage />
    </MemoryRouter>,
  );
}

describe('PipelineSchedulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
    mockDelete.mockReturnValue({ unwrap: () => Promise.resolve() });
  });

  it('renders a row per schedule', () => {
    mockGetSchedules.mockReturnValue({ data: [schedule()], isLoading: false });
    renderPage();
    expect(screen.getByText('Refresh feeds')).toBeInTheDocument();
    expect(screen.getByText('*/15 * * * *')).toBeInTheDocument();
  });

  it('shows an empty state when there are no schedules', () => {
    mockGetSchedules.mockReturnValue({ data: [], isLoading: false });
    renderPage();
    expect(screen.getByText(/no schedules yet/i)).toBeInTheDocument();
  });

  it('toggling enabled dispatches updateSchedule', () => {
    mockGetSchedules.mockReturnValue({ data: [schedule()], isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole('switch'));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'sched-1',
      projectId: 'proj-1',
      data: { enabled: false },
    });
  });
});
