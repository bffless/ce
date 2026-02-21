import { Routes, Route } from 'react-router-dom';
import { RepositoryPage } from '@/pages/RepositoryPage';
import { RepositoryOverviewPage } from '@/pages/RepositoryOverviewPage';
import { RepositoriesPage } from '@/pages/RepositoriesPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { UserGroupsPage } from '@/pages/UserGroupsPage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserSettingsPage } from '@/pages/UserSettingsPage';
import { AdminSettingsPage } from '@/pages/AdminSettingsPage';
import { DomainsPage } from '@/pages/DomainsPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { SetupPage } from '@/pages/SetupPage';
import { InvitationAcceptPage } from '@/pages/InvitationAcceptPage';
import { Toaster } from '@/components/ui/toaster';
import { Header } from '@/components/layout/Header';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { usePendoInit } from '@/hooks/usePendoInit';

function App() {
  usePendoInit();

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background">
        <Header />
        <Routes>
        {/* Protected home route (admin control panel) */}
        <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />

        {/* Setup route (pre-auth) */}
        <Route path="/setup" element={<SetupPage />} />

        {/* Authentication routes (public) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/invite/:token" element={<InvitationAcceptPage />} />

        {/* User Settings route (requires auth) */}
        <Route path="/settings" element={<ProtectedRoute><UserSettingsPage /></ProtectedRoute>} />

        {/* Admin Settings route (requires admin) */}
        <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettingsPage /></ProtectedRoute>} />

        {/* Repository routes */}
        <Route path="/repo" element={<ProtectedRoute><RepositoriesPage /></ProtectedRoute>} />
        <Route path="/repo/:owner/:repo/settings" element={<ProtectedRoute><ProjectSettingsPage /></ProtectedRoute>} />
        <Route path="/repo/:owner/:repo/:ref/*" element={<RepositoryPage />} />
        <Route path="/repo/:owner/:repo/:ref" element={<RepositoryPage />} />
        <Route path="/repo/:owner/:repo" element={<RepositoryOverviewPage />} />

        {/* User Groups routes (admin only) */}
        <Route path="/groups" element={<ProtectedRoute requireAdmin><UserGroupsPage /></ProtectedRoute>} />
        <Route path="/groups/:groupId" element={<ProtectedRoute requireAdmin><GroupDetailPage /></ProtectedRoute>} />

        {/* Users route (admin only) */}
        <Route path="/users" element={<ProtectedRoute requireAdmin><UsersPage /></ProtectedRoute>} />

        {/* Domains route (admin only) */}
        <Route path="/domains" element={<ProtectedRoute requireAdmin><DomainsPage /></ProtectedRoute>} />
        </Routes>
        <Toaster />
      </div>
    </ErrorBoundary>
  );
}

export default App;
