import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { Pagination } from './Pagination';
import repositoryListSlice from '@/store/slices/repositoryListSlice';

// Mock window.scrollTo
global.scrollTo = vi.fn();

// Create a mock store for testing
const createMockStore = () => {
  return configureStore({
    reducer: {
      repositoryList: repositoryListSlice,
    },
    preloadedState: {
      repositoryList: {
        currentPage: 1,
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
        sidebarSearch: '',
        feedSearch: '',
      },
    },
  });
};

// Wrapper component with Redux store
const ReduxWrapper = ({ children, store }: { children: React.ReactNode; store: any }) => {
  return <Provider store={store}>{children}</Provider>;
};

describe('Pagination', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    vi.clearAllMocks();
  });

  it('renders pagination controls', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    expect(screen.getByLabelText(/Previous page/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Next page/i)).toBeInTheDocument();
  });

  it('displays current page info', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={2} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    expect(screen.getByText(/Page 2 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/100 total repositories/i)).toBeInTheDocument();
  });

  it('displays "repository" singular for count of 1', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={1} total={1} />
      </ReduxWrapper>
    );

    // With 1 page, pagination is hidden, so we need to test with 2 pages
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={2} total={1} />
      </ReduxWrapper>
    );

    expect(screen.getByText(/1 total repository$/i)).toBeInTheDocument();
  });

  it('does not render if totalPages is 1 or less', () => {
    const { container } = render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={1} total={10} />
      </ReduxWrapper>
    );

    // Navigation should not be present
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });

  it('disables Previous button on first page', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const prevButton = screen.getByLabelText(/Previous page/i);
    expect(prevButton).toBeDisabled();
  });

  it('disables Next button on last page', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={5} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const nextButton = screen.getByLabelText(/Next page/i);
    expect(nextButton).toBeDisabled();
  });

  it('enables Previous button when not on first page', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={3} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const prevButton = screen.getByLabelText(/Previous page/i);
    expect(prevButton).not.toBeDisabled();
  });

  it('enables Next button when not on last page', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={3} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const nextButton = screen.getByLabelText(/Next page/i);
    expect(nextButton).not.toBeDisabled();
  });

  it('displays all page numbers when totalPages <= 7', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 5')).toBeInTheDocument();
  });

  it('displays ellipsis when totalPages > 7', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={10} total={200} />
      </ReduxWrapper>
    );

    const ellipsis = screen.getAllByText('...');
    expect(ellipsis.length).toBeGreaterThan(0);
  });

  it('highlights current page button', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={3} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const currentPageButton = screen.getByLabelText('Page 3');
    expect(currentPageButton).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to next page when Next button is clicked', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={2} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const nextButton = screen.getByLabelText(/Next page/i);
    fireEvent.click(nextButton);

    // Redux state should be updated to page 3
    expect(store.getState().repositoryList.currentPage).toBe(3);
  });

  it('navigates to previous page when Previous button is clicked', () => {
    // Start on page 3
    store = configureStore({
      reducer: {
        repositoryList: repositoryListSlice,
      },
      preloadedState: {
        repositoryList: {
          currentPage: 3,
          sortBy: 'updatedAt' as const,
          sortOrder: 'desc' as const,
          sidebarSearch: '',
          feedSearch: '',
        },
      },
    });

    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={3} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const prevButton = screen.getByLabelText(/Previous page/i);
    fireEvent.click(prevButton);

    // Redux state should be updated to page 2
    expect(store.getState().repositoryList.currentPage).toBe(2);
  });

  it('navigates to specific page when page number is clicked', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const page4Button = screen.getByLabelText('Page 4');
    fireEvent.click(page4Button);

    // Redux state should be updated to page 4
    expect(store.getState().repositoryList.currentPage).toBe(4);
  });

  it('scrolls to top when page changes', () => {
    const { rerender } = render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    // Clear previous scroll calls
    vi.clearAllMocks();

    // Change page
    rerender(
      <ReduxWrapper store={store}>
        <Pagination currentPage={2} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    // Should have called scrollTo
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('has proper navigation role and aria-label', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('aria-label', 'Repository pagination');
  });

  it('displays live region for page info', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const liveRegion = screen.getByText(/Page 1 of 5/i);
    // Check that the text is inside an element with aria-live
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('page buttons have proper ARIA labels', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const page1 = screen.getByLabelText('Page 1');
    const page2 = screen.getByLabelText('Page 2');
    const page3 = screen.getByLabelText('Page 3');

    expect(page1).toBeInTheDocument();
    expect(page2).toBeInTheDocument();
    expect(page3).toBeInTheDocument();
  });

  it('does not show page numbers on mobile (hidden sm:flex)', () => {
    const { container } = render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={1} totalPages={5} total={100} />
      </ReduxWrapper>
    );

    const pageNumbersContainer = container.querySelector('.hidden.sm\\:flex');
    expect(pageNumbersContainer).toBeInTheDocument();
  });

  it('shows first and last page with ellipsis for large page counts', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={5} totalPages={20} total={400} />
      </ReduxWrapper>
    );

    // Should always show page 1 and page 20
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 20')).toBeInTheDocument();

    // Should show ellipsis
    const ellipsis = screen.getAllByText('...');
    expect(ellipsis.length).toBeGreaterThan(0);
  });

  it('shows pages around current page for large page counts', () => {
    render(
      <ReduxWrapper store={store}>
        <Pagination currentPage={10} totalPages={20} total={400} />
      </ReduxWrapper>
    );

    // Should show pages around 10 (e.g., 9, 10, 11)
    expect(screen.getByLabelText('Page 9')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 10')).toBeInTheDocument();
    expect(screen.getByLabelText('Page 11')).toBeInTheDocument();
  });
});
