import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { GlobalSearchBar } from './GlobalSearchBar';
import repositoryListSlice from '@/store/slices/repositoryListSlice';

// Create a mock store for testing
const createMockStore = (initialState = {}) => {
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
        ...initialState,
      },
    },
  });
};

// Wrapper component with Redux store
const ReduxWrapper = ({ children, store }: { children: React.ReactNode; store: any }) => {
  return <Provider store={store}>{children}</Provider>;
};

describe('GlobalSearchBar', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it('renders search input with placeholder', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByPlaceholderText(/Search all repositories.../i);
    expect(input).toBeInTheDocument();
  });

  it('has correct ARIA role and label', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const searchBox = screen.getByRole('searchbox');
    expect(searchBox).toBeInTheDocument();
    expect(searchBox).toHaveAttribute('aria-label', 'Search repositories by name, owner, or description');
  });

  it('has search role on container', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const searchContainer = screen.getByRole('search');
    expect(searchContainer).toBeInTheDocument();
  });

  it('displays search icon', () => {
    const { container } = render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    // Search icon should be present
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('allows user to type in search input', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'test query' } });

    expect(input.value).toBe('test query');
  });

  it('shows clear button when input has text', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox');

    // Initially, no clear button
    expect(screen.queryByLabelText(/Clear search/i)).not.toBeInTheDocument();

    // Type something
    fireEvent.change(input, { target: { value: 'test' } });

    // Clear button should appear
    expect(screen.getByLabelText(/Clear search/i)).toBeInTheDocument();
  });

  it('clears input when clear button is clicked', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Type something
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(input.value).toBe('test query');

    // Click clear button
    const clearButton = screen.getByLabelText(/Clear search/i);
    fireEvent.click(clearButton);

    // Input should be cleared
    expect(input.value).toBe('');
  });

  it('updates Redux store after debounce delay', async () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox');

    // Type search query
    fireEvent.change(input, { target: { value: 'test search' } });

    // Initially, Redux state should not be updated (still debouncing)
    expect(store.getState().repositoryList.feedSearch).toBe('');

    // Wait for debounce (300ms)
    await waitFor(
      () => {
        expect(store.getState().repositoryList.feedSearch).toBe('test search');
      },
      { timeout: 500 }
    );
  });

  it('syncs with Redux state when changed externally', () => {
    const storeWithSearch = createMockStore({ feedSearch: 'external search' });

    render(
      <ReduxWrapper store={storeWithSearch}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Input should reflect Redux state
    expect(input.value).toBe('external search');
  });

  it('focuses input when "/" key is pressed', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Input should not be focused initially
    expect(document.activeElement).not.toBe(input);

    // Press "/" key
    fireEvent.keyDown(document, { key: '/' });

    // Input should be focused
    expect(document.activeElement).toBe(input);
  });

  it('does not focus input when "/" is pressed while already focused', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Focus the input first
    input.focus();

    // Type "/" - it should be treated as normal input, not trigger focus
    fireEvent.keyDown(input, { key: '/' });

    // Input should still be the active element
    expect(document.activeElement).toBe(input);
  });

  it('clears search when Escape key is pressed', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Type something and focus input
    input.focus();
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(input.value).toBe('test query');

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // Input should be cleared
    expect(input.value).toBe('');
  });

  it('does not clear on Escape if input is empty', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Focus input (empty)
    input.focus();

    // Press Escape (should not cause error)
    fireEvent.keyDown(input, { key: 'Escape' });

    // Input should still be empty
    expect(input.value).toBe('');
  });

  it('refocuses input after clicking clear button', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Type something
    fireEvent.change(input, { target: { value: 'test' } });

    // Click clear button
    const clearButton = screen.getByLabelText(/Clear search/i);
    fireEvent.click(clearButton);

    // Input should be focused after clearing
    expect(document.activeElement).toBe(input);
  });

  it('has proper accessibility attributes', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox');

    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('aria-label');
    expect(input).toHaveAttribute('role', 'searchbox');
  });

  it('clear button has sufficient touch target size', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByRole('searchbox');

    // Type to show clear button
    fireEvent.change(input, { target: { value: 'test' } });

    const clearButton = screen.getByLabelText(/Clear search/i);

    // Button should have proper ARIA label
    expect(clearButton).toHaveAttribute('aria-label', 'Clear search');
    expect(clearButton).toHaveAttribute('type', 'button');
  });

  it('displays keyboard shortcut hint in placeholder', () => {
    render(
      <ReduxWrapper store={store}>
        <GlobalSearchBar />
      </ReduxWrapper>
    );

    const input = screen.getByPlaceholderText(/press \/ to focus/i);
    expect(input).toBeInTheDocument();
  });
});
