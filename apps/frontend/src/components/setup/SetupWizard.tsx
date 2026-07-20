import { useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { RootState } from '@/store';
import { useGetSetupStatusQuery, SetupStatusResponse } from '@/services/setupApi';
import { setWizardStep, setClaimToken } from '@/store/slices/setupSlice';
import { SetupProgress } from './SetupProgress';
import { ClaimStep } from './ClaimStep';
import { AdminAccountStep } from './AdminAccountStep';
import { DomainSslStep } from './DomainSslStep';
import { StorageStep } from './StorageStep';
import { CacheStep } from './CacheStep';
import { EmailStep } from './EmailStep';
import { ApplyStep } from './ApplyStep';
import { CompleteStep } from './CompleteStep';

type StepId =
  | 'claim'
  | 'admin'
  | 'domain-ssl'
  | 'storage'
  | 'cache'
  | 'email'
  | 'apply'
  | 'complete';

const STEP_COMPONENTS: Record<StepId, () => JSX.Element | null> = {
  claim: ClaimStep,
  admin: AdminAccountStep,
  'domain-ssl': DomainSslStep,
  storage: StorageStep,
  cache: CacheStep,
  email: EmailStep,
  apply: ApplyStep,
  complete: CompleteStep,
};

/**
 * Computes the wizard's step list.
 *
 * Normal mode (unchanged): ['admin', 'storage', 'cache', 'email', 'complete']
 *
 * Bootstrap mode: ['claim'?, 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']
 * — 'claim' only appears when the backend requires it AND no `?token=` was
 * found in the URL (the Platform relay path auto-claims and skips it).
 */
export function computeWizardSteps(
  status: SetupStatusResponse | undefined,
  urlToken: string | null
): StepId[] {
  if (!status?.bootstrapMode) {
    return ['admin', 'storage', 'cache', 'email', 'complete'];
  }

  const steps: StepId[] = [];
  if (status.claimRequired && !urlToken) {
    steps.push('claim');
  }
  return [...steps, 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply'];
}

export function SetupWizard() {
  const dispatch = useDispatch();
  const { currentStep, error } = useSelector((state: RootState) => state.setup.wizard);
  const { data: setupStatus } = useGetSetupStatusQuery();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token');

  // Track if initial sync has been done to prevent continuous auto-advancing
  const hasInitializedRef = useRef(false);
  // Track if the URL token has already been stashed in the store
  const hasStashedTokenRef = useRef(false);

  // Platform relay: if `?token=` is present in the URL, stash it in the store
  // (on mount only) so downstream steps (AdminAccountStep) can send it, and so
  // bootstrap mode's step list skips the claim step entirely.
  useEffect(() => {
    if (hasStashedTokenRef.current) return;
    hasStashedTokenRef.current = true;
    if (urlToken) {
      dispatch(setClaimToken(urlToken));
    }
  }, [urlToken, dispatch]);

  const steps = useMemo(
    () => computeWizardSteps(setupStatus, urlToken),
    [setupStatus, urlToken]
  );

  // Auto-advance to the correct step based on backend state
  // This ONLY runs once on initial mount to handle page refresh scenarios
  useEffect(() => {
    if (!setupStatus || hasInitializedRef.current) return;

    // Mark as initialized so this only runs once
    hasInitializedRef.current = true;

    const adminIndex = steps.indexOf('admin');
    const storageIndex = steps.indexOf('storage');

    // Determine what step we should be on based on backend state
    let targetStep = 1;

    if (setupStatus.hasAdminUser && adminIndex !== -1) {
      targetStep = adminIndex + 2; // 1-based position of the step right after 'admin'
    }

    if (setupStatus.hasAdminUser && setupStatus.storageProvider && storageIndex !== -1) {
      targetStep = storageIndex + 2; // 1-based position of the step right after 'storage'
    }

    // Note: We don't auto-advance past cache/email/domain-ssl/apply steps since
    // the backend doesn't track their configuration state in the same way

    // Only advance forward on initial load, never go back (user might be reviewing)
    if (targetStep > currentStep) {
      dispatch(setWizardStep(targetStep));
    }
  }, [setupStatus, currentStep, dispatch, steps]);

  const currentStepId = steps[currentStep - 1] ?? steps[0];
  const StepComponent = STEP_COMPONENTS[currentStepId];

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
        <SetupProgress currentStep={currentStep} totalSteps={steps.length} />

        <div className="bg-card py-8 px-4 shadow-sm sm:rounded-lg sm:px-10 mt-6 border">
          {error && (
            <div className="mb-4 bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <StepComponent />
        </div>
      </div>
    </div>
  );
}
