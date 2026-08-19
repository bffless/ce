import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useGetTelemetryStatusQuery, useUpdateTelemetryMutation } from '@/services/settingsApi';

/**
 * Admin toggle for opt-out install telemetry. Reflects (and can override) the
 * `telemetry_enabled` flag; when TELEMETRY=off is set, the switch is forced off
 * and disabled since the env var always wins.
 */
export function TelemetrySettings() {
  const { data: status, isLoading } = useGetTelemetryStatusQuery();
  const [updateTelemetry, { isLoading: isSaving }] = useUpdateTelemetryMutation();

  const forcedOff = status?.forcedOffByEnv ?? false;
  const enabled = forcedOff ? false : (status?.enabled ?? true);

  const handleToggle = async (next: boolean) => {
    try {
      await updateTelemetry({ enabled: next }).unwrap();
    } catch {
      // RTK keeps the previous cached value on failure; nothing else to do.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anonymous Usage Data</CardTitle>
        <CardDescription>
          Send an anonymous weekly ping to help improve BFFless: a random install ID, version, OS,
          and <em>bucketed</em> counts (e.g. &ldquo;2&ndash;5&rdquo;) of projects, deployments, and
          users. Never your domains, content, or any personal data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="telemetry-toggle" className="cursor-pointer">
            Send anonymous usage data
          </Label>
          <Switch
            id="telemetry-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || isSaving || forcedOff}
          />
        </div>

        {forcedOff && (
          <p className="text-xs text-muted-foreground">
            Disabled by the <code className="bg-muted px-1 rounded">TELEMETRY=off</code> environment
            variable, which overrides this setting.
          </p>
        )}

        {!forcedOff && status?.lastSentAt && (
          <p className="text-xs text-muted-foreground">
            Last sent: {new Date(status.lastSentAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
