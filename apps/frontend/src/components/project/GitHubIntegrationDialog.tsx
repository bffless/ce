import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  useSetIntegrationConfigMutation,
  useTestIntegrationConnectionMutation,
  type IntegrationInfo,
} from '@/services/integrationsApi';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface GitHubIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  integration: IntegrationInfo;
}

export function GitHubIntegrationDialog({
  open,
  onOpenChange,
  projectId,
  integration,
}: GitHubIntegrationDialogProps) {
  const { toast } = useToast();

  const [personalAccessToken, setPersonalAccessToken] = useState('');
  const [defaultOrg, setDefaultOrg] = useState(
    (integration.publicConfig?.defaultOrg as string) || '',
  );

  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const [setConfig, { isLoading: isSaving }] = useSetIntegrationConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();

  const hasConfig = integration.hasProductionConfig;

  const handleSave = async () => {
    if (!hasConfig && !personalAccessToken) {
      toast({
        title: 'Error',
        description: 'Personal Access Token is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const config: Record<string, string> = {};
      if (personalAccessToken) config.personalAccessToken = personalAccessToken;
      if (defaultOrg) config.defaultOrg = defaultOrg;

      await setConfig({
        projectId,
        integrationId: 'github',
        environment: 'production',
        config,
      }).unwrap();

      toast({
        title: 'Saved',
        description: 'GitHub integration configured successfully',
      });

      setPersonalAccessToken('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to save configuration',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const result = await testConnection({
        projectId,
        integrationId: 'github',
        environment: 'production',
      }).unwrap();

      setTestResult(result);
    } catch (error: any) {
      setTestResult({
        success: false,
        error: error?.data?.message || 'Connection test failed',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Configure GitHub Integration</DialogTitle>
          <DialogDescription>
            Enter a GitHub Personal Access Token to use the{' '}
            <code>github_api</code> pipeline handler for creating repositories
            from templates and other GitHub API operations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {hasConfig && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                GitHub integration is configured. Enter new values to update.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Personal Access Token *</Label>
            <Input
              type="password"
              placeholder={hasConfig ? '••••••••••••••••' : 'ghp_...'}
              value={personalAccessToken}
              onChange={(e) => setPersonalAccessToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Requires <code>repo</code> scope for creating repositories
            </p>
          </div>

          <div className="space-y-2">
            <Label>Default Organization</Label>
            <Input
              type="text"
              placeholder="my-org"
              value={defaultOrg}
              onChange={(e) => setDefaultOrg(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Used as the default target org when creating repositories.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={isSaving || (!hasConfig && !personalAccessToken)}
            >
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>

            {hasConfig && (
              <Button variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>
            )}
          </div>

          {testResult && (
            <Alert variant={testResult.success ? 'default' : 'destructive'}>
              {testResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {testResult.success
                  ? 'Successfully connected to GitHub!'
                  : `Connection failed: ${testResult.error}`}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
