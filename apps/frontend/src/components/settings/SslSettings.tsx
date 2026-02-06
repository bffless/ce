import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useGetSslSettingsQuery,
  useUpdateSslSettingsMutation,
  useGetAllSslRenewalHistoryQuery,
  useTriggerRenewalCheckMutation,
} from '@/services/domainsApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { RefreshCw, CheckCircle, XCircle, MinusCircle, Shield } from 'lucide-react';

export function SslSettings() {
  const { toast } = useToast();
  const { isEnabled } = useFeatureFlags();
  const { data: settings, isLoading: loadingSettings } = useGetSslSettingsQuery();
  const { data: history = [], isLoading: loadingHistory } =
    useGetAllSslRenewalHistoryQuery({ limit: 20 });
  const [updateSettings, { isLoading: isUpdating }] =
    useUpdateSslSettingsMutation();
  const [triggerCheck, { isLoading: isTriggering }] =
    useTriggerRenewalCheckMutation();

  const [thresholdDays, setThresholdDays] = useState(30);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [wildcardAutoRenew, setWildcardAutoRenew] = useState(true);

  useEffect(() => {
    if (settings) {
      setThresholdDays(settings.renewalThresholdDays);
      setNotificationEmail(settings.notificationEmail || '');
      setWildcardAutoRenew(settings.wildcardAutoRenew);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings({
        renewalThresholdDays: thresholdDays,
        notificationEmail: notificationEmail || undefined,
        wildcardAutoRenew,
      }).unwrap();
      toast({
        title: 'Settings saved',
        description: 'SSL auto-renewal settings have been updated.',
      });
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to save settings',
        variant: 'destructive',
      });
    }
  };

  const handleTriggerCheck = async () => {
    try {
      await triggerCheck().unwrap();
      toast({
        title: 'Check triggered',
        description: 'SSL renewal check has been triggered.',
      });
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      toast({
        title: 'Error',
        description: err.data?.message || 'Failed to trigger check',
        variant: 'destructive',
      });
    }
  };

  // Hide SSL settings on PaaS where Traefik handles SSL at the edge
  if (!isEnabled('ENABLE_WILDCARD_SSL')) {
    return null;
  }

  if (loadingSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            SSL Certificate Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Loading settings...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Auto-Renewal Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            SSL Certificate Auto-Renewal
          </CardTitle>
          <CardDescription>
            Configure automatic SSL certificate renewal settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">
                Renewal Threshold (days)
              </label>
              <p className="text-sm text-muted-foreground mb-2">
                Renew certificates when they expire within this many days
              </p>
              <Input
                type="number"
                value={thresholdDays}
                onChange={(e) =>
                  setThresholdDays(parseInt(e.target.value) || 30)
                }
                min={1}
                max={90}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Notification Email</label>
              <p className="text-sm text-muted-foreground mb-2">
                Email to notify on renewal failures
              </p>
              <Input
                type="email"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">
                Wildcard Auto-Renewal
              </label>
              <p className="text-sm text-muted-foreground">
                Automatically renew the wildcard certificate (requires DNS API
                integration)
              </p>
            </div>
            <Switch
              checked={wildcardAutoRenew}
              onCheckedChange={setWildcardAutoRenew}
            />
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={handleSave} disabled={isUpdating}>
              {isUpdating ? 'Saving...' : 'Save Settings'}
            </Button>
            <Button
              variant="outline"
              onClick={handleTriggerCheck}
              disabled={isTriggering}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isTriggering ? 'animate-spin' : ''}`}
              />
              Run Renewal Check Now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Renewal History */}
      <Card>
        <CardHeader>
          <CardTitle>Renewal History</CardTitle>
          <CardDescription>Recent certificate renewal attempts</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="text-muted-foreground">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-muted-foreground">No renewal history</div>
          ) : (
            <div className="space-y-2">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 border rounded"
                >
                  <div className="flex items-center gap-3">
                    {record.status === 'success' && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {record.status === 'failed' && (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    {record.status === 'skipped' && (
                      <MinusCircle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium">{record.domain}</div>
                      <div className="text-sm text-muted-foreground">
                        {record.certificateType === 'wildcard'
                          ? 'Wildcard'
                          : 'Individual'}
                        {' · '}
                        {record.triggeredBy === 'auto' ? 'Automatic' : 'Manual'}
                        {record.status === 'failed' &&
                          record.errorMessage && (
                            <span className="ml-2 text-red-500">
                              - {record.errorMessage}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        record.status === 'success'
                          ? 'default'
                          : record.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {record.status}
                    </Badge>
                    <div className="text-sm text-muted-foreground mt-1">
                      {format(new Date(record.createdAt), 'PPp')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
