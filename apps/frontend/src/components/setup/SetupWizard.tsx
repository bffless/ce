import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useGetSetupStatusQuery } from '@/services/setupApi';
import { setWizardStep } from '@/store/slices/setupSlice';
import { SetupProgress } from './SetupProgress';
import { AdminAccountStep } from './AdminAccountStep';
import { StorageStep } from './StorageStep';
import { CacheStep } from './CacheStep';
import { EmailStep } from './EmailStep';
import { CompleteStep } from './CompleteStep';

export function SetupWizard() {
  const dispatch = useDispatch();
  const { currentStep, error } = useSelector((state: RootState) => state.setup.wizard);
  const { data: setupStatus } = useGetSetupStatusQuery();

  // Track if initial sync has been done to prevent continuous auto-advancing
  const hasInitializedRef = useRef(false);

  // Auto-advance to the correct step based on backend state
  // This ONLY runs once on initial mount to handle page refresh scenarios
  useEffect(() => {
    if (!setupStatus || hasInitializedRef.current) return;

    // Mark as initialized so this only runs once
    hasInitializedRef.current = true;

    // Determine what step we should be on based on backend state
    let targetStep = 1;

    if (setupStatus.hasAdminUser) {
      targetStep = 2; // Admin created, move to storage step
    }

    if (setupStatus.hasAdminUser && setupStatus.storageProvider) {
      targetStep = 3; // Storage configured, move to cache step
    }

    // Note: We don't auto-advance past cache/email steps since the backend
    // doesn't track their configuration state in the same way

    // Only advance forward on initial load, never go back (user might be reviewing)
    if (targetStep > currentStep) {
      dispatch(setWizardStep(targetStep));
    }
  }, [setupStatus, currentStep, dispatch]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <AdminAccountStep />;
      case 2:
        return <StorageStep />;
      case 3:
        return <CacheStep />;
      case 4:
        return <EmailStep />;
      case 5:
        return <CompleteStep />;
      default:
        return <AdminAccountStep />;
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-foreground">
          Platform Setup
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Complete these steps to configure your platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <SetupProgress currentStep={currentStep} totalSteps={5} />

        <div className="bg-card py-8 px-4 shadow-sm sm:rounded-lg sm:px-10 mt-6 border">
          {error && (
            <div className="mb-4 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {renderStep()}
        </div>
      </div>
    </div>
  );
}
