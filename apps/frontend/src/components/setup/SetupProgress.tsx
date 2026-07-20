import { CheckCircle } from 'lucide-react';
import { StepId } from '@/store/slices/setupSlice';

interface SetupProgressProps {
  /** The wizard's currently-active step list (normal or bootstrap). */
  steps: StepId[];
  /** 1-based index of the current step within `steps`. */
  currentStep: number;
}

// Human-readable label for every step id. Driven by the ACTUAL computed step
// list (see SetupWizard.computeWizardSteps) rather than a hardcoded array, so
// the progress header reflects bootstrap mode's Claim / Domain & SSL / Apply
// steps instead of silently showing the normal-mode labels in every mode.
export const STEP_LABELS: Record<StepId, string> = {
  claim: 'Claim',
  admin: 'Admin Account',
  'domain-ssl': 'Domain & SSL',
  storage: 'Storage',
  cache: 'Cache',
  email: 'Email',
  apply: 'Apply',
  complete: 'Complete',
};

export function SetupProgress({ steps, currentStep }: SetupProgressProps) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center justify-center space-x-5">
        {steps.map((stepId, index) => {
          const position = index + 1; // 1-based, matches currentStep
          const label = STEP_LABELS[stepId];
          return (
            <li key={stepId} className="flex items-center">
              {position < currentStep ? (
                // Completed step
                <span className="flex items-center">
                  <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-primary rounded-full">
                    <CheckCircle className="w-6 h-6 text-primary-foreground" />
                  </span>
                  <span className="ml-3 text-sm font-medium text-muted-foreground hidden sm:block">
                    {label}
                  </span>
                </span>
              ) : position === currentStep ? (
                // Current step
                <span className="flex items-center">
                  <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center border-2 border-primary rounded-full">
                    <span className="text-primary font-bold">{position}</span>
                  </span>
                  <span className="ml-3 text-sm font-medium text-primary hidden sm:block">
                    {label}
                  </span>
                </span>
              ) : (
                // Future step
                <span className="flex items-center">
                  <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center border-2 border-muted-foreground/30 rounded-full">
                    <span className="text-muted-foreground">{position}</span>
                  </span>
                  <span className="ml-3 text-sm font-medium text-muted-foreground hidden sm:block">
                    {label}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
