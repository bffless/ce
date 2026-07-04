import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleFormDialog } from './ScheduleFormDialog';
import type { PipelineSchedule, PipelineRuleOption } from '@/services/pipelineSchedulesApi';

const mockGetRuleOptions = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/services/pipelineSchedulesApi', () => ({
  useGetPipelineRuleOptionsQuery: (_arg: unknown, opts: { skip?: boolean }) =>
    mockGetRuleOptions(opts),
  useCreateScheduleMutation: () => [mockCreate, { isLoading: false }],
  useUpdateScheduleMutation: () => [mockUpdate, { isLoading: false }],
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

const ruleOption = (o: Partial<PipelineRuleOption> = {}): PipelineRuleOption => ({
  id: 'rule-1',
  name: 'feeds-sync',
  ruleSetId: 'set-1',
  ruleSetName: 'Feeds',
  pathPattern: '/api/feeds',
  method: 'GET',
  ...o,
});

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

describe('ScheduleFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRuleOptions.mockReturnValue({ data: [ruleOption()], isLoading: false });
    mockCreate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(schedule()) });
  });

  it('shows the cron description for a valid expression and enables submit', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My schedule' } });
    // default cron field starts blank; type a valid expression
    fireEvent.change(screen.getByLabelText(/cron/i), { target: { value: '0 * * * *' } });
    expect(screen.getByText(/every hour/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create schedule/i })).not.toBeDisabled();
  });

  it('blocks submit when the cron expression is invalid', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/cron/i), { target: { value: 'nonsense' } });
    expect(screen.getByRole('button', { name: /create schedule/i })).toBeDisabled();
  });

  it('applies a preset to the cron field', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hourly/i }));
    expect(screen.getByLabelText(/cron/i)).toHaveValue('0 * * * *');
  });

  it('prefills fields in edit mode', () => {
    render(
      <ScheduleFormDialog
        projectId="proj-1"
        owner="acme"
        repo="site"
        schedule={schedule()}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue('Refresh feeds');
    expect(screen.getByLabelText(/cron/i)).toHaveValue('*/15 * * * *');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });
});
