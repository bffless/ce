import { Routes, Route } from 'react-router-dom';
import { RepositoryPage } from '@/pages/RepositoryPage';
import { RepositoryLayout } from '@/pages/RepositoryLayout';
import { RepositoriesPage } from '@/pages/RepositoriesPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { DeploymentsTab } from '@/pages/DeploymentsTab';
import { BranchesPage } from '@/pages/BranchesPage';
import { AliasesPage } from '@/pages/AliasesPage';
import { ProxyRuleSetsPage } from '@/pages/ProxyRuleSetsPage';
import { RuleSetDetailPage } from '@/pages/RuleSetDetailPage';
import { RuleEditorPage } from '@/pages/RuleEditorPage';
import PipelineLogsPage from '@/pages/PipelineLogsPage';
import { SchemasListPage } from '@/pages/SchemasListPage';
import { SchemaDetailPage } from '@/pages/SchemaDetailPage';
import { SchemaEditorPage } from '@/pages/SchemaEditorPage';
import { UploadsListPage } from '@/pages/UploadsListPage';
import { UploadDetailPage } from '@/pages/UploadDetailPage';
import { RepositoryTabRedirect } from '@/pages/RepositoryTabRedirect';
import { UserGroupsPage } from '@/pages/UserGroupsPage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserSettingsPage } from '@/pages/UserSettingsPage';
import { AdminSettingsPage } from '@/pages/AdminSettingsPage';
import { GeneralTab } from '@/pages/admin-settings/GeneralTab';
import { AuthTab } from '@/pages/admin-settings/AuthTab';
import { EmailTab } from '@/pages/admin-settings/EmailTab';
import { InfrastructureTab } from '@/pages/admin-settings/InfrastructureTab';
import { DomainsPage } from '@/pages/DomainsPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { LogoutPage } from '@/pages/LogoutPage';
import { SignupPage } from '@/pages/SignupPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { SetupPage } from '@/pages/SetupPage';
import { InvitationAcceptPage } from '@/pages/InvitationAcceptPage';
import { OAuthCallbackPage } from '@/pages/OAuthCallbackPage';
import { OAuthSignInCallbackPage } from '@/pages/OAuthSignInCallbackPage';
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
        <Route path="/logout" element={<LogoutPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/invite/:token" element={<InvitationAcceptPage />} />

        {/* OAuth sign-in callback (Google OAuth redirect) */}
        <Route path="/oauth/signin/callback" element={<OAuthSignInCallbackPage />} />

        {/* OAuth callback (handles plugin OAuth redirects) */}
        <Route path="/oauth/callback" element={<ProtectedRoute><OAuthCallbackPage /></ProtectedRoute>} />

        {/* User Settings route (requires auth) */}
        <Route path="/settings" element={<ProtectedRoute><UserSettingsPage /></ProtectedRoute>} />

        {/* Admin Settings routes (requires admin, tabbed layout) */}
        <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettingsPage /></ProtectedRoute>}>
          <Route index element={<GeneralTab />} />
          <Route path="auth" element={<AuthTab />} />
          <Route path="email" element={<EmailTab />} />
          <Route path="infrastructure" element={<InfrastructureTab />} />
        </Route>

        {/* Repository list */}
        <Route path="/repo" element={<ProtectedRoute><RepositoriesPage /></ProtectedRoute>} />

        {/* Repository settings (outside of tab layout) */}
        <Route path="/repo/:owner/:repo/settings" element={<ProtectedRoute><ProjectSettingsPage /></ProtectedRoute>} />

        {/* File browser routes (must come before the layout to avoid matching) */}
        <Route path="/repo/:owner/:repo/:ref/*" element={<RepositoryPage />} />
        <Route path="/repo/:owner/:repo/:ref" element={<RepositoryPage />} />

        {/* Repository tabs layout with nested routes */}
        <Route path="/repo/:owner/:repo" element={<ProtectedRoute><RepositoryLayout /></ProtectedRoute>}>
          {/* Handle old query param URLs and redirect to deployments by default */}
          <Route index element={<RepositoryTabRedirect />} />
          <Route path="deployments" element={<DeploymentsTab />} />
          <Route path="branches" element={<BranchesPage />} />
          <Route path="aliases" element={<AliasesPage />} />
          <Route path="proxy-rules" element={<ProxyRuleSetsPage />} />
          <Route path="proxy-rules/:ruleSetId" element={<RuleSetDetailPage />} />
          <Route path="proxy-rules/:ruleSetId/new" element={<RuleEditorPage />} />
          <Route path="proxy-rules/:ruleSetId/:ruleId" element={<RuleEditorPage />} />
          <Route path="proxy-rules/:ruleSetId/:ruleId/logs" element={<PipelineLogsPage />} />
          <Route path="data" element={<SchemasListPage />} />
          <Route path="data/new" element={<SchemaEditorPage />} />
          <Route path="data/:schemaId" element={<SchemaDetailPage />} />
          <Route path="data/:schemaId/edit" element={<SchemaEditorPage />} />
          <Route path="uploads" element={<UploadsListPage />} />
          <Route path="uploads/:schemaId" element={<UploadDetailPage />} />
        </Route>

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
