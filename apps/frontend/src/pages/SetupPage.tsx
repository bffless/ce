import { Navigate } from 'react-router-dom';
import { useGetSetupStatusQuery } from '@/services/setupApi';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { Loader2 } from 'lucide-react';

export function SetupPage() {
  const { data: status, isLoading, error } = useGetSetupStatusQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-destructive">Error loading setup status. Please refresh.</div>
      </div>
    );
  }

  // If setup is complete, redirect to login
  if (status?.isSetupComplete) {
    return <Navigate to="/login" replace />;
  }

  return <SetupWizard />;
}
