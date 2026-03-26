import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { PrimaryContentSettings } from '@/components/settings/PrimaryContentSettings';

export function GeneralTab() {
  return (
    <div className="space-y-6">
      <BrandingSettings />
      <PrimaryContentSettings />
    </div>
  );
}
