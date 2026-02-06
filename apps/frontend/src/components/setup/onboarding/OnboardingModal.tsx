import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '@/store';
import { completeOnboarding, setOnboardingStep } from '@/store/slices/setupSlice';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateRepoStep } from './CreateRepoStep';
import { ApiKeyStep } from './ApiKeyStep';
import { GitHubActionsStep } from './GitHubActionsStep';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const dispatch = useDispatch();
  const { onboardingStep, createdProjectId, createdApiKey } = useSelector(
    (state: RootState) => state.setup.onboarding
  );

  const handleSkip = () => {
    dispatch(completeOnboarding());
    onClose();
  };

  const handleNext = () => {
    if (onboardingStep < 3) {
      dispatch(setOnboardingStep(onboardingStep + 1));
    } else {
      dispatch(completeOnboarding());
      onClose();
    }
  };

  const renderStep = () => {
    switch (onboardingStep) {
      case 1:
        return <CreateRepoStep onNext={handleNext} onSkip={handleSkip} />;
      case 2:
        return (
          <ApiKeyStep
            projectId={createdProjectId}
            onNext={handleNext}
            onSkip={handleSkip}
          />
        );
      case 3:
        return (
          <GitHubActionsStep
            apiKey={createdApiKey}
            onComplete={handleSkip}
          />
        );
      default:
        return null;
    }
  };

  const getTitle = () => {
    switch (onboardingStep) {
      case 1:
        return 'Create Your First Repository';
      case 2:
        return 'Generate API Key';
      case 3:
        return 'Set Up GitHub Actions';
      default:
        return 'Getting Started';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <div className="mt-4">{renderStep()}</div>
      </DialogContent>
    </Dialog>
  );
}
