// Curated, growable feature-toggle section (Admin Settings → Features).
// Each entry is a DB-backed feature flag (Database > env > default) rendered as a
// toggle row. Deliberately a registry, not an enumeration of all flags — flags
// appear here only when an operator-facing toggle is intentional.
import type { ComponentType } from 'react';
import { useGetFeatureFlagQuery, useSetFeatureFlagMutation } from '@/services/featureFlagsApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Clapperboard, ToggleRight, type LucideIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FfmpegExecutorSettings } from './FfmpegExecutorSettings';

type FeatureToggle = {
  flagKey: string;
  icon: LucideIcon;
  title: string;
  description: string; // row description under the label
  enabledToast: { title: string; description: string };
  disabledToast: { title: string; description: string };
  /** Optional configuration panel rendered under the toggle row. */
  Panel?: ComponentType;
};

const FEATURE_TOGGLES: FeatureToggle[] = [
  {
    flagKey: 'FFMPEG_HANDLER_ENABLED',
    icon: Clapperboard,
    title: 'Server video ops',
    description:
      'Apps that support it (e.g. Studio) slice, stitch, and extract audio via ffmpeg on this ' +
      'server — the video never leaves the bucket. Wants at least 1.5–2 GB of backend memory; ' +
      'jobs that do not fit are refused and apps fall back to in-browser processing. ' +
      'When off, apps always process in the browser.',
    enabledToast: {
      title: 'Server video ops enabled',
      description: 'Apps will use this server for video processing on their next session.',
    },
    disabledToast: {
      title: 'Server video ops disabled',
      description: 'Apps fall back to in-browser processing.',
    },
    Panel: FfmpegExecutorSettings,
  },
];

function FeatureToggleRow({ toggle }: { toggle: FeatureToggle }) {
  const { toast } = useToast();
  const { data: flag, isLoading, error } = useGetFeatureFlagQuery(toggle.flagKey);
  const [setFeatureFlag, { isLoading: isUpdating }] = useSetFeatureFlagMutation();

  const enabled = Boolean(flag?.value);
  const Icon = toggle.icon;

  const handleToggle = async (next: boolean) => {
    try {
      await setFeatureFlag({ key: toggle.flagKey, value: next, enabled: true }).unwrap();
      const message = next ? toggle.enabledToast : toggle.disabledToast;
      toast(message);
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'data' in err
          ? (err.data as { message?: string })?.message || 'An error occurred'
          : 'An error occurred';
      toast({
        title: 'Failed to update setting',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load setting.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-start gap-3 pr-4">
        <Icon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="space-y-0.5">
          <Label className="text-base font-medium">{toggle.title}</Label>
          <p className="text-sm text-muted-foreground">{toggle.description}</p>
        </div>
      </div>
      <Switch checked={enabled} onCheckedChange={handleToggle} disabled={isUpdating} />
    </div>
  );
}

export function FeatureToggles() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ToggleRight className="h-5 w-5" />
          <div>
            <CardTitle>Features</CardTitle>
            <CardDescription>Optional platform capabilities, stored per instance</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURE_TOGGLES.map((toggle) => (
          <div key={toggle.flagKey} className="space-y-3">
            <FeatureToggleRow toggle={toggle} />
            {toggle.Panel && <toggle.Panel />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
