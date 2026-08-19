import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { useState } from 'react';
import { PageTitleProvider } from './DocumentTitle';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const siteName = vi.hoisted(() => ({ current: 'BFFLESS' }));

vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ siteName: siteName.current }),
}));

function renderAt(initialPath: string, ui?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PageTitleProvider>
        {ui ?? (
          <Routes>
            <Route path="*" element={<Link to="/domains">domains</Link>} />
          </Routes>
        )}
      </PageTitleProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  siteName.current = 'BFFLESS';
  document.title = '';
});

describe('PageTitleProvider', () => {
  it('sets a route-derived title on first render', async () => {
    renderAt('/users');
    await waitFor(() => expect(document.title).toBe('Users · BFFLESS'));
  });

  it('updates the title when the URL changes client-side', async () => {
    const user = userEvent.setup();
    renderAt('/users');
    await waitFor(() => expect(document.title).toBe('Users · BFFLESS'));

    await user.click(screen.getByRole('link', { name: 'domains' }));
    await waitFor(() => expect(document.title).toBe('Domains · BFFLESS'));
  });

  it('re-renders the title when the branded site name loads', async () => {
    const { rerender } = renderAt('/users');
    await waitFor(() => expect(document.title).toBe('Users · BFFLESS'));

    siteName.current = 'Acme Deploys';
    rerender(
      <MemoryRouter initialEntries={['/users']}>
        <PageTitleProvider>
          <div />
        </PageTitleProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.title).toBe('Users · Acme Deploys'));
  });
});

describe('useDocumentTitle', () => {
  function Page({ title }: { title: string | null }) {
    useDocumentTitle(title ? [title, 'User groups'] : null);
    return <div>page</div>;
  }

  it('overrides the route-derived title', async () => {
    renderAt('/groups/g1', <Page title="Platform admins" />);
    await waitFor(() => expect(document.title).toBe('Platform admins · User groups · BFFLESS'));
  });

  it('keeps the route-derived title while the page data is loading', async () => {
    renderAt('/groups/g1', <Page title={null} />);
    await waitFor(() => expect(document.title).toBe('Group · User groups · BFFLESS'));
  });

  it('preserves parts that contain spaces', async () => {
    renderAt('/groups/g1', <Page title="Two Word Name" />);
    await waitFor(() => expect(document.title).toBe('Two Word Name · User groups · BFFLESS'));
  });

  it('falls back to the route title when the overriding page unmounts', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <button onClick={() => setMounted(false)}>unmount</button>
          {mounted && <Page title="Platform admins" />}
        </>
      );
    }

    renderAt('/groups/g1', <Harness />);
    await waitFor(() => expect(document.title).toBe('Platform admins · User groups · BFFLESS'));

    await user.click(screen.getByRole('button', { name: 'unmount' }));
    await waitFor(() => expect(document.title).toBe('Group · User groups · BFFLESS'));
  });
});
