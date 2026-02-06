import { useNavigate } from 'react-router-dom';
import { PrimaryContentSettings } from '@/components/settings/PrimaryContentSettings';
import { EmailSettings } from '@/components/settings/EmailSettings';
import { InvitationsSettings } from '@/components/settings/InvitationsSettings';
import { RegistrationSettings } from '@/components/settings/RegistrationSettings';
import { SslSettings } from '@/components/settings/SslSettings';
import { CacheSettings } from '@/components/settings/CacheSettings';
import { StorageSettings } from '@/components/settings/StorageSettings';
import { StorageUsageCard } from '@/components/storage/StorageUsageCard';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings } from 'lucide-react';

/**
 * AdminSettingsPage - Global platform settings (admin only)
 * Route: /admin/settings
 * Requires: Admin role (enforced by ProtectedRoute in App.tsx)
 */
export function AdminSettingsPage() {
  const navigate = useNavigate();

  // Handler for back navigation
  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Settings className="h-6 w-6" />
            <div>
              <h1 className="text-2xl font-bold">Site Settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage your platform configuration
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Domain Content */}
      <section>
        <PrimaryContentSettings />
      </section>

      {/* Email Settings */}
      <section>
        <EmailSettings />
      </section>

      {/* Registration Settings */}
      <section>
        <RegistrationSettings />
      </section>

      {/* User Invitations */}
      <section>
        <InvitationsSettings />
      </section>

      {/* SSL Certificate Settings */}
      <section>
        <SslSettings />
      </section>

      {/* Cache Settings */}
      <section>
        <CacheSettings />
      </section>

      {/* Storage Usage */}
      <section>
        <StorageUsageCard />
      </section>

      {/* Storage Settings */}
      <section>
        <StorageSettings />
      </section>
    </div>
  );
}