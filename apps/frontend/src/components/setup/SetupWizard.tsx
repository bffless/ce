import { useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { RootState } from '@/store';
import { useGetSetupStatusQuery, SetupStatusResponse } from '@/services/setupApi';
import { setWizardStep, setStepOrder, setClaimToken, StepId } from '@/store/slices/setupSlice';
import { SetupProgress } from './SetupProgress';
import { ClaimStep } from './ClaimStep';
import { AdminAccountStep } from './AdminAccountStep';
import { DomainSslStep } from './DomainSslStep';
import { StorageStep } from './StorageStep';
import { CacheStep } from './CacheStep';
import { EmailStep } from './EmailStep';
import { ApplyStep } from './ApplyStep';
import { CompleteStep } from './CompleteStep';

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
 *
 * `seededToken` is the same token once it's landed in the store (from
 * either source — see the seeding effect below). It exists because the
 * seeding effect scrubs `?token=` out of the URL right after stashing it
 * (same reasoning as ClaimStep's own scrub — it must not linger in the
 * address bar/history), which makes `urlToken` go back to `null` on the
 * very next render. Without this fallback, that would incorrectly
 * resurrect the already-skipped 'claim' step.
 */
export function computeWizardSteps(
  status: SetupStatusResponse | undefined,
  urlToken: string | null,
  seededToken?: string | null
): StepId[] {
  if (!status?.bootstrapMode) {
    return ['admin', 'storage', 'cache', 'email', 'complete'];
  }

  const steps: StepId[] = [];
  if (status.claimRequired && !urlToken && !seededToken) {
    steps.push('claim');
  }
  return [...steps, 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply'];
}

// The claim token lives in Redux (in-memory), which a full page reload clears.
// That strands a user who reloads AFTER creating the admin but BEFORE applying:
// claimRequired is false once an admin exists, so the claim step won't reappear
// to re-collect it, yet the (session-less) cert/apply endpoints still require
// it — a 401 with no way forward. Persisting it in sessionStorage (tab-scoped,
// auto-cleared on tab close, first-party only) survives the reload. It is no
// more exposed than it already is in Redux/memory, and it is inert once setup
// completes.
const CLAIM_TOKEN_STORAGE_KEY = 'bffless.setup.claimToken';

function readStoredClaimToken(): string | null {
  try {
    return sessionStorage.getItem(CLAIM_TOKEN_STORAGE_KEY);
  } catch {
    return null; // sessionStorage can throw (privacy mode / disabled)
  }
}

export function SetupWizard() {
  const dispatch = useDispatch();
  const {
    currentStepId: storedStepId,
    error,
    claimToken,
  } = useSelector((state: RootState) => state.setup.wizard);
  const { data: setupStatus } = useGetSetupStatusQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlToken = searchParams.get('token');

  // Track if initial sync has been done to prevent continuous auto-advancing
  const hasInitializedRef = useRef(false);
  // Track if the token has already been stashed in the store
  const hasStashedTokenRef = useRef(false);

  // On mount, seed the claim token into the store from (in priority order) the
  // `?token=` URL relay (Platform), then sessionStorage (survives a reload —
  // see CLAIM_TOKEN_STORAGE_KEY). Downstream steps (AdminAccountStep,
  // DomainSslStep, ApplyStep) read it from the store to authenticate their
  // session-less requests.
  //
  // A `?token=` here means computeWizardSteps already skipped 'claim'
  // entirely (see its doc comment), so ClaimStep's own URL-scrub effect
  // never mounts to clean up after it. This is the only path a
  // Platform-relay / install.sh link actually takes, so the scrub has to
  // happen here instead — otherwise the token lingers in the address bar
  // and browser history indefinitely. `{ replace: true }` avoids adding a
  // history entry, same as ClaimStep's `history.replaceState`.
  useEffect(() => {
    if (hasStashedTokenRef.current) return;
    hasStashedTokenRef.current = true;
    if (urlToken) {
      dispatch(setClaimToken(urlToken));
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('token');
          return next;
        },
        { replace: true }
      );
      return;
    }
    const stored = readStoredClaimToken();
    if (stored) {
      dispatch(setClaimToken(stored));
    }
  }, [urlToken, dispatch, setSearchParams]);

  // Persist the token so a reload doesn't lose it. Cleared explicitly when it
  // becomes empty; otherwise it clears itself when the tab closes.
  useEffect(() => {
    try {
      if (claimToken) {
        sessionStorage.setItem(CLAIM_TOKEN_STORAGE_KEY, claimToken);
      } else {
        sessionStorage.removeItem(CLAIM_TOKEN_STORAGE_KEY);
      }
    } catch {
      /* sessionStorage unavailable — persistence is best-effort */
    }
  }, [claimToken]);

  // `claimToken` (from the store) is the seeded-token fallback described in
  // computeWizardSteps' doc comment: it's set synchronously in the same
  // dispatch batch that clears `urlToken` via the scrub above, so this
  // stays stable across that re-render instead of flickering 'claim' back
  // in.
  const steps = useMemo(
    () => computeWizardSteps(setupStatus, urlToken, claimToken),
    [setupStatus, urlToken, claimToken]
  );

  // Keep the store's stepOrder in sync with the currently active list. This
  // is what lets `currentStepId` survive the list changing shape mid-session
  // (see Critical-1, final review): as long as the id is still present
  // somewhere in the new list, the reducer leaves it alone regardless of
  // where it now sits positionally.
  useEffect(() => {
    dispatch(setStepOrder(steps));
  }, [steps, dispatch]);

  // currentStepId is null before any explicit navigation, or if the active
  // list reshaped out from under a (now-gone) id — fall back to the list's
  // first step, same as the very first render.
  const currentIndex = storedStepId ? steps.indexOf(storedStepId) : -1;
  const currentStepId: StepId = currentIndex !== -1 ? storedStepId! : steps[0];
  const effectiveIndex = currentIndex !== -1 ? currentIndex : 0;

  // Auto-advance to the correct step based on backend state
  // This ONLY runs once on initial mount to handle page refresh scenarios
  useEffect(() => {
    if (!setupStatus || hasInitializedRef.current) return;

    // Mark as initialized so this only runs once
    hasInitializedRef.current = true;

    const adminIndex = steps.indexOf('admin');
    const storageIndex = steps.indexOf('storage');

    // Determine what step we should be on based on backend state
    let targetStepId: StepId = steps[0];

    if (setupStatus.hasAdminUser && adminIndex !== -1 && steps[adminIndex + 1]) {
      targetStepId = steps[adminIndex + 1]; // the step right after 'admin'
    }

    if (
      setupStatus.hasAdminUser &&
      setupStatus.storageProvider &&
      storageIndex !== -1 &&
      steps[storageIndex + 1]
    ) {
      targetStepId = steps[storageIndex + 1]; // the step right after 'storage'
    }

    // Note: We don't auto-advance past cache/email/domain-ssl/apply steps since
    // the backend doesn't track their configuration state in the same way

    // Only advance forward on initial load, never go back (user might be
    // reviewing) — compared by POSITION in the current list, not id
    // equality, since a raw id comparison can't express "further along".
    const targetIndex = steps.indexOf(targetStepId);
    if (targetIndex > effectiveIndex) {
      dispatch(setWizardStep(targetStepId));
    }
  }, [setupStatus, effectiveIndex, dispatch, steps]);

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
        <SetupProgress steps={steps} currentStep={effectiveIndex + 1} />

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
