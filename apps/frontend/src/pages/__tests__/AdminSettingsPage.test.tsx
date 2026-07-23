import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminSettingsPage } from '../AdminSettingsPage';

vi.mock('@/services/featureFlagsApi', () => ({
  useFeatureFlags: () => ({ isEnabled: (k: string) => k === 'ENABLE_PRIMARY_SSL_MANAGEMENT' }),
}));
vi.mock('@/services/authApi', () => ({
  useGetSessionQuery: () => ({ data: { user: { role: 'admin' } }, isLoading: false }),
}));

describe('AdminSettingsPage', () => {
  it('shows the SSL tab when the flag is enabled', () => {
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <Routes>
          <Route path="/admin/settings/*" element={<AdminSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('SSL')).toBeInTheDocument();
  });
});
