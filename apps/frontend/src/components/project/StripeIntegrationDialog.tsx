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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useSetIntegrationConfigMutation,
  useSwitchIntegrationEnvironmentMutation,
  useTestIntegrationConnectionMutation,
  type IntegrationInfo,
} from '@/services/integrationsApi';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface StripeIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  integration: IntegrationInfo;
}

export function StripeIntegrationDialog({
  open,
  onOpenChange,
  projectId,
  integration,
}: StripeIntegrationDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('sandbox');

  // Sandbox keys
  const [sandboxPublishableKey, setSandboxPublishableKey] = useState('');
  const [sandboxSecretKey, setSandboxSecretKey] = useState('');
  const [sandboxWebhookSecret, setSandboxWebhookSecret] = useState('');

  // Production keys
  const [prodPublishableKey, setProdPublishableKey] = useState('');
  const [prodSecretKey, setProdSecretKey] = useState('');
  const [prodWebhookSecret, setProdWebhookSecret] = useState('');

  // Test result state
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  const [setConfig, { isLoading: isSaving }] = useSetIntegrationConfigMutation();
  const [switchEnv] = useSwitchIntegrationEnvironmentMutation();
  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();

  const handleSaveEnvironment = async (environment: 'sandbox' | 'production') => {
    const keys =
      environment === 'sandbox'
        ? {
            publishableKey: sandboxPublishableKey,
            secretKey: sandboxSecretKey,
            webhookSecret: sandboxWebhookSecret,
          }
        : {
            publishableKey: prodPublishableKey,
            secretKey: prodSecretKey,
            webhookSecret: prodWebhookSecret,
          };

    if (!keys.secretKey) {
      toast({
        title: 'Error',
        description: 'Secret Key is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await setConfig({
        projectId,
        integrationId: 'stripe',
        environment,
        config: keys,
      }).unwrap();

      toast({
        title: 'Saved',
        description: `${environment === 'sandbox' ? 'Sandbox' : 'Production'} keys saved successfully`,
      });

      // Clear form after save
      if (environment === 'sandbox') {
        setSandboxPublishableKey('');
        setSandboxSecretKey('');
        setSandboxWebhookSecret('');
      } else {
        setProdPublishableKey('');
        setProdSecretKey('');
        setProdWebhookSecret('');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to save configuration',
        variant: 'destructive',
      });
    }
  };

  const handleSwitchEnvironment = async (environment: 'sandbox' | 'production') => {
    try {
      await switchEnv({
        projectId,
        integrationId: 'stripe',
        environment,
      }).unwrap();

      toast({
        title: 'Environment switched',
        description: `Now using ${environment} keys`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.data?.message || 'Failed to switch environment',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const result = await testConnection({
        projectId,
        integrationId: 'stripe',
        environment: activeTab as 'sandbox' | 'production',
      }).unwrap();

      setTestResult(result);
    } catch (error: any) {
      setTestResult({
        success: false,
        error: error?.data?.message || 'Connection test failed',
      });
    }
  };

  const renderKeyForm = (environment: 'sandbox' | 'production') => {
    const publishableKey = environment === 'sandbox' ? sandboxPublishableKey : prodPublishableKey;
    const secretKey = environment === 'sandbox' ? sandboxSecretKey : prodSecretKey;
    const webhookSecret = environment === 'sandbox' ? sandboxWebhookSecret : prodWebhookSecret;
    const setPublishable = environment === 'sandbox' ? setSandboxPublishableKey : setProdPublishableKey;
    const setSecret = environment === 'sandbox' ? setSandboxSecretKey : setProdSecretKey;
    const setWebhook = environment === 'sandbox' ? setSandboxWebhookSecret : setProdWebhookSecret;
    const hasConfig = environment === 'sandbox' ? integration.hasSandboxConfig : integration.hasProductionConfig;

    return (
      <div className="space-y-4">
        {hasConfig && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              {environment === 'sandbox' ? 'Sandbox' : 'Production'} keys are configured.
              Enter new values to update them.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label>Publishable Key</Label>
          <Input
            type="password"
            placeholder={hasConfig ? '••••••••••••••••' : `pk_${environment === 'sandbox' ? 'test' : 'live'}_...`}
            value={publishableKey}
            onChange={(e) => setPublishable(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Secret Key *</Label>
          <Input
            type="password"
            placeholder={hasConfig ? '••••••••••••••••' : `sk_${environment === 'sandbox' ? 'test' : 'live'}_...`}
            value={secretKey}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Webhook Signing Secret</Label>
          <Input
            type="password"
            placeholder={hasConfig ? '••••••••••••••••' : 'whsec_...'}
            value={webhookSecret}
            onChange={(e) => setWebhook(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Required for the <code>stripe_webhook</code> pipeline handler to verify signatures
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => handleSaveEnvironment(environment)}
            disabled={isSaving || !secretKey}
          >
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save {environment === 'sandbox' ? 'Sandbox' : 'Production'} Keys
          </Button>

          {hasConfig && (
            <>
              <Button variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Test Connection
              </Button>

              {integration.activeEnvironment !== environment && (
                <Button
                  variant="outline"
                  onClick={() => handleSwitchEnvironment(environment)}
                >
                  Set as Active
                </Button>
              )}
            </>
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
                ? 'Successfully connected to Stripe!'
                : `Connection failed: ${testResult.error}`}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Stripe Integration</DialogTitle>
          <DialogDescription>
            Enter your Stripe API keys for sandbox and production environments.
            Use the <code>stripe_checkout</code> and <code>stripe_webhook</code> pipeline
            handlers in your proxy rules to create checkout sessions and handle webhooks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Active environment indicator */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Active environment:</span>
            <Badge variant={integration.activeEnvironment === 'production' ? 'default' : 'secondary'}>
              {integration.activeEnvironment === 'production' ? 'Production' : 'Sandbox'}
            </Badge>
          </div>

          {/* Environment tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="sandbox" className="flex-1">Sandbox</TabsTrigger>
              <TabsTrigger value="production" className="flex-1">Production</TabsTrigger>
            </TabsList>
            <TabsContent value="sandbox" className="mt-4">
              {renderKeyForm('sandbox')}
            </TabsContent>
            <TabsContent value="production" className="mt-4">
              {renderKeyForm('production')}
            </TabsContent>
          </Tabs>
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
