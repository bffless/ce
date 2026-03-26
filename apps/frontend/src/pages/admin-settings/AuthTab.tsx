import { AuthenticationSettings } from '@/components/settings/AuthenticationSettings';
import { RegistrationSettings } from '@/components/settings/RegistrationSettings';
import { InvitationsSettings } from '@/components/settings/InvitationsSettings';
import { OnboardingRulesSettings } from '@/components/settings/OnboardingRulesSettings';

export function AuthTab() {
  return (
    <div className="space-y-6">
      <AuthenticationSettings />
      <RegistrationSettings />
      <InvitationsSettings />
      <OnboardingRulesSettings />
    </div>
  );
}
