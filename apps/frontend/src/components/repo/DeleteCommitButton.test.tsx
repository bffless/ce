import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { DeleteCommitButton } from './DeleteCommitButton';
import { api } from '@/services/api';

// Mock the TooltipProvider to avoid React hook issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// Mock the AlertDialog components
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock useProjectRole to return canEdit: true (so the button renders)
vi.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => ({
    role: 'owner',
    isLoading: false,
    canEdit: true,
    canAdmin: true,
    isOwner: true,
  }),
}));

// Default props for tests
const defaultProps = {
  owner: 'testowner',
  repo: 'testrepo',
  commitSha: 'abc123def456789012345678901234567890abcd',
  aliases: [] as string[],
  deploymentCount: 4,
  totalSize: 28540928,
  totalFiles: 835,
};

// Helper function to create a test store
function createTestStore() {
  return configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });
}

// Helper function to render component with providers
function renderWithProviders(props: Partial<typeof defaultProps> = {}) {
  const store = createTestStore();
  return {
    ...render(
      <Provider store={store}>
        <MemoryRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <DeleteCommitButton {...defaultProps} {...props} />
        </MemoryRouter>
      </Provider>,
    ),
    store,
  };
}

describe('DeleteCommitButton', () => {
  beforeEach(() => {
    mockToast.mockClear();
  });

  it('renders delete button', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /delete commit/i })).toBeInTheDocument();
  });

  it('disables button when aliases exist', () => {
    renderWithProviders({ aliases: ['production'] });
    const button = screen.getByRole('button', { name: /delete commit/i });
    expect(button).toBeDisabled();
  });

  it('enables button when no aliases exist', () => {
    renderWithProviders({ aliases: [] });
    const button = screen.getByRole('button', { name: /delete commit/i });
    expect(button).not.toBeDisabled();
  });

  it('opens confirmation dialog when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders();

    const button = screen.getByRole('button', { name: /delete commit/i });
    await user.click(button);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it('shows commit stats in dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders();

    await user.click(screen.getByRole('button', { name: /delete commit/i }));

    // Check for short SHA (first 7 chars)
    expect(screen.getByText('abc123d')).toBeInTheDocument();
    // Check deployments count
    expect(screen.getByText('4')).toBeInTheDocument();
    // Check files count
    expect(screen.getByText('835')).toBeInTheDocument();
    // Check size is formatted (28540928 bytes = ~27.2 MB)
    expect(screen.getByText(/27\.2 MB/i)).toBeInTheDocument();
  });

  it('shows cancel button in dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders();

    await user.click(screen.getByRole('button', { name: /delete commit/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Verify cancel button exists in the dialog
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).not.toBeDisabled();
  });

  it('displays correct number of deployments', async () => {
    const user = userEvent.setup();
    renderWithProviders({ deploymentCount: 10 });

    await user.click(screen.getByRole('button', { name: /delete commit/i }));

    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('displays correct number of files', async () => {
    const user = userEvent.setup();
    renderWithProviders({ totalFiles: 1234 });

    await user.click(screen.getByRole('button', { name: /delete commit/i }));

    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('shows tooltip content when aliases exist', () => {
    renderWithProviders({ aliases: ['production', 'staging'] });

    // The tooltip content should be rendered (even if hidden normally)
    expect(screen.getByTestId('tooltip-content')).toBeInTheDocument();
    expect(screen.getByText(/cannot delete/i)).toBeInTheDocument();
    expect(screen.getByText(/production, staging/i)).toBeInTheDocument();
  });

  it('does not show tooltip content when no aliases', () => {
    renderWithProviders({ aliases: [] });

    // The tooltip content should not be rendered when button is enabled
    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument();
  });
});
