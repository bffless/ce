import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { PrimaryContentSettings } from '@/components/settings/PrimaryContentSettings';
import { TelemetrySettings } from '@/components/settings/TelemetrySettings';

export function GeneralTab() {
  return (
    <div className="space-y-6">
      <BrandingSettings />
      <PrimaryContentSettings />
      <TelemetrySettings />
    </div>
  );
}
