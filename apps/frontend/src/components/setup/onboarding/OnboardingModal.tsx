import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '@/store';
import { completeOnboarding, setOnboardingStep } from '@/store/slices/setupSlice';
import { useGetSessionQuery } from '@/services/authApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBranding } from '@/hooks/useBranding';
import { WelcomeStep } from './WelcomeStep';
import { CreateRepoStep } from './CreateRepoStep';
import { ApiKeyStep } from './ApiKeyStep';
import { GitHubActionsStep } from './GitHubActionsStep';

const LAST_STEP = 4;

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const dispatch = useDispatch();
  const { siteName } = useBranding();
  const navigate = useNavigate();
  const { data: sessionData } = useGetSessionQuery();
  const { isEnabled } = useFeatureFlags();
  // /apps is an admin-only route — only offer the apps path to admins, and
  // only when the app catalog is enabled. The catalog can be disabled (e.g.
  // platform-managed deployments), in which case /apps is a dead end and the
  // backend refuses its endpoints. isEnabled() returns false while flags are
  // still loading, so this safely degrades to the single-path layout rather
  // than briefly flashing the apps path before flags resolve.
  const showAppsPath = sessionData?.user?.role === 'admin' && isEnabled('ENABLE_APP_CATALOG');
  const { onboardingStep, createdProjectId, createdApiKey } = useSelector(
    (state: RootState) => state.setup.onboarding,
  );

  const handleSkip = () => {
    dispatch(completeOnboarding());
    onClose();
  };

  const handleInstallApps = () => {
    dispatch(completeOnboarding());
    onClose();
    navigate('/apps');
  };

  const handleNext = () => {
    if (onboardingStep < LAST_STEP) {
      dispatch(setOnboardingStep(onboardingStep + 1));
    } else {
      dispatch(completeOnboarding());
      onClose();
    }
  };

  const renderStep = () => {
    switch (onboardingStep) {
      case 1:
        return (
          <WelcomeStep
            onNext={handleNext}
            onSkip={handleSkip}
            onInstallApps={handleInstallApps}
            showAppsPath={showAppsPath}
          />
        );
      case 2:
        return <CreateRepoStep onNext={handleNext} onSkip={handleSkip} />;
      case 3:
        return <ApiKeyStep projectId={createdProjectId} onNext={handleNext} onSkip={handleSkip} />;
      case 4:
        return <GitHubActionsStep apiKey={createdApiKey} onComplete={handleSkip} />;
      default:
        return null;
    }
  };

  const getTitle = () => {
    switch (onboardingStep) {
      case 1:
        return `Welcome to ${siteName}`;
      case 2:
        return 'Create Your First Repository';
      case 3:
        return 'Generate API Key';
      case 4:
        return 'Set Up GitHub Actions';
      default:
        return 'Getting Started';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* DialogContent is vertically centred with no height cap of its own, so
          the welcome step's video would push the buttons off-screen on short
          viewports (~700px laptops). Cap and scroll instead. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <div className="mt-4">{renderStep()}</div>
      </DialogContent>
    </Dialog>
  );
}
