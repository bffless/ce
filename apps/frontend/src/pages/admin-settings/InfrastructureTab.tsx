import { SslSettings } from '@/components/settings/SslSettings';
import { CacheSettings } from '@/components/settings/CacheSettings';
import { StorageUsageCard } from '@/components/storage/StorageUsageCard';
import { StorageSettings } from '@/components/settings/StorageSettings';

export function InfrastructureTab() {
  return (
    <div className="space-y-6">
      <SslSettings />
      <CacheSettings />
      <StorageUsageCard />
      <StorageSettings />
    </div>
  );
}
