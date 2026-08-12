import { useNavigate, Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TabScroller } from '@/components/common/TabScroller';
import { ArrowLeft, Settings, Paintbrush, Shield, Mail, Server, Lock, ToggleRight } from 'lucide-react';
import { useFeatureFlags } from '@/services/featureFlagsApi';

const TABS = [
  { value: 'general', path: '/admin/settings', label: 'General', icon: Paintbrush },
  { value: 'auth', path: '/admin/settings/auth', label: 'Authentication', icon: Shield },
  { value: 'email', path: '/admin/settings/email', label: 'Email', icon: Mail },
  { value: 'infrastructure', path: '/admin/settings/infrastructure', label: 'Infrastructure', icon: Server },
  { value: 'features', path: '/admin/settings/features', label: 'Features', icon: ToggleRight },
  { value: 'ssl', path: '/admin/settings/ssl', label: 'SSL', icon: Lock },
] as const;

/**
 * AdminSettingsPage - Global platform settings (admin only)
 * Route: /admin/settings/*
 * Requires: Admin role (enforced by ProtectedRoute in App.tsx)
 */
export function AdminSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isEnabled } = useFeatureFlags();

  // Determine current tab from pathname
  const pathAfterSettings = location.pathname.replace('/admin/settings', '');
  const currentTab = pathAfterSettings.startsWith('/infrastructure')
    ? 'infrastructure'
    : pathAfterSettings.startsWith('/email')
      ? 'email'
      : pathAfterSettings.startsWith('/auth')
        ? 'auth'
        : pathAfterSettings.startsWith('/features')
          ? 'features'
          : pathAfterSettings.startsWith('/ssl')
            ? 'ssl'
            : 'general';

  const visibleTabs = TABS.filter(
    (tab) => tab.value !== 'ssl' || isEnabled('ENABLE_PRIMARY_SSL_MANAGEMENT'),
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
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

      {/* Tabs Navigation */}
      <Tabs value={currentTab} className="w-full">
        <TabScroller>
          <TabsList>
            {visibleTabs.map(({ value, path, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} asChild>
                <Link to={path} className="gap-1.5">
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </TabScroller>
      </Tabs>

      {/* Tab Content - rendered via Outlet */}
      <div>
        <Outlet />
      </div>
    </div>
  );
}
