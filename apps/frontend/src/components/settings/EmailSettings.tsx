import { useState, useEffect } from 'react';
import {
  useGetEmailStatusQuery,
  useUpdateEmailSettingsMutation,
  useTestEmailSettingsMutation,
  useSendTestEmailMutation,
  SettingsEmailProvider,
} from '@/services/settingsApi';
import { useGetEmailProvidersQuery, useGetAvailableOptionsQuery, EmailProviderInfo } from '@/services/setupApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Mail,
  AlertTriangle,
  Edit2,
  Zap,
  Send,
  Shield,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Provider metadata for display (fallback if API not available)
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  managed: 'Managed Email',
  smtp: 'SMTP',
  sendgrid: 'SendGrid',
  resend: 'Resend',
  ses: 'Amazon SES',
  mailgun: 'Mailgun',
  postmark: 'Postmark',
};

export function EmailSettings() {
  const { data: emailStatus, isLoading: isLoadingStatus } = useGetEmailStatusQuery();
  const { data: providersData } = useGetEmailProvidersQuery();
  const { data: availableOptions } = useGetAvailableOptionsQuery();
  const [updateEmail, { isLoading: isUpdating }] = useUpdateEmailSettingsMutation();
  const [testEmail, { isLoading: isTesting }] = useTestEmailSettingsMutation();
  const [sendTestEmail, { isLoading: isSendingTest }] = useSendTestEmailMutation();

  // Get email options from feature flags
  const emailOptions = availableOptions?.email;
  const enableManagedEmail = emailOptions?.managed ?? false;
  const enableSmtp = emailOptions?.smtp ?? true;
  const enableSendGrid = emailOptions?.sendgrid ?? true;
  const enableResend = emailOptions?.resend ?? true;

  // Check if currently using managed email
  const isUsingManagedEmail = emailStatus?.provider === 'managed';

  const [isEditing, setIsEditing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<SettingsEmailProvider | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Send test email state
  const [showSendTest, setShowSendTest] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendTestResult, setSendTestResult] = useState<{
    success: boolean;
    message: string;
    error?: string;
    messageId?: string;
  } | null>(null);

  // Provider-specific form state
  const [smtpConfig, setSmtpConfig] = useState({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  const [apiKeyConfig, setApiKeyConfig] = useState({
    apiKey: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  // Filter to only implemented providers based on feature flags
  const implementedProviders = (providersData?.providers.filter((p: EmailProviderInfo) => {
    if (!p.implemented) return false;
    // Filter based on feature flags
    switch (p.id) {
      case 'smtp':
        return enableSmtp;
      case 'sendgrid':
        return enableSendGrid;
      case 'resend':
        return enableResend;
      case 'managed':
        return false; // Handled separately in UI
      default:
        return true;
    }
  }) || []);

  // Initialize selected provider when editing starts
  useEffect(() => {
    if (isEditing && emailStatus?.provider) {
      setSelectedProvider(emailStatus.provider as SettingsEmailProvider);

      // Pre-populate from address and name
      if (emailStatus.provider === 'smtp') {
        setSmtpConfig((prev) => ({
          ...prev,
          host: emailStatus.host || '',
          port: emailStatus.port || 587,
          secure: emailStatus.secure || false,
          fromAddress: emailStatus.fromAddress || '',
          fromName: emailStatus.fromName || 'Static Asset Platform',
        }));
      } else {
        setApiKeyConfig((prev) => ({
          ...prev,
          fromAddress: emailStatus.fromAddress || '',
          fromName: emailStatus.fromName || 'Static Asset Platform',
        }));
      }
    }
  }, [isEditing, emailStatus]);

  const handleStartEditing = () => {
    setIsEditing(true);
    setTestResult(null);
    setUpdateError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTestResult(null);
    setUpdateError(null);
    setSelectedProvider(null);
    setSmtpConfig({
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      fromAddress: '',
      fromName: 'Static Asset Platform',
    });
    setApiKeyConfig({
      apiKey: '',
      fromAddress: '',
      fromName: 'Static Asset Platform',
    });
  };

  const getConfigForProvider = (): Record<string, unknown> | null => {
    if (!selectedProvider) return null;

    if (selectedProvider === 'managed') {
      return {}; // Managed email uses platform credentials
    }

    if (selectedProvider === 'smtp') {
      return smtpConfig;
    }

    // API key based providers
    return apiKeyConfig;
  };

  const isFormValid = (): boolean => {
    if (!selectedProvider) return false;

    // Managed email is always valid
    if (selectedProvider === 'managed') return true;

    if (selectedProvider === 'smtp') {
      return !!(smtpConfig.host && smtpConfig.port && smtpConfig.user && smtpConfig.password);
    }

    // API key based providers
    return !!(apiKeyConfig.apiKey && apiKeyConfig.fromAddress);
  };

  const handleSave = async () => {
    if (!selectedProvider) return;

    const config = getConfigForProvider();
    if (!config) return;

    try {
      setUpdateError(null);
      await updateEmail({ provider: selectedProvider, config }).unwrap();
      setIsEditing(false);
      setTestResult(null);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setUpdateError(err.data?.message || 'Failed to update email configuration');
    }
  };

  const handleTest = async () => {
    if (!selectedProvider) return;

    const config = getConfigForProvider();
    if (!config) return;

    try {
      setTestResult(null);
      setUpdateError(null);

      // First save the config
      await updateEmail({ provider: selectedProvider, config }).unwrap();

      // Then test
      const result = await testEmail().unwrap();
      setTestResult(result);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setTestResult({
        success: false,
        message: 'Failed to test email',
        error: err.data?.message || 'Unknown error',
      });
    }
  };

  const getProviderDisplayName = (provider: string): string => {
    return PROVIDER_DISPLAY_NAMES[provider] || provider;
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes('@')) return;

    try {
      setSendTestResult(null);
      const result = await sendTestEmail({ to: testEmailAddress }).unwrap();
      setSendTestResult(result);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setSendTestResult({
        success: false,
        message: 'Failed to send test email',
        error: err.data?.message || 'Unknown error',
      });
    }
  };

  const handleCloseSendTest = () => {
    setShowSendTest(false);
    setTestEmailAddress('');
    setSendTestResult(null);
  };

  if (isLoadingStatus) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Settings
        </CardTitle>
        <CardDescription>
          Configure email for password reset emails and notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isEditing ? (
          // View mode
          <>
            {emailStatus?.isConfigured ? (
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">
                    Email configured via {emailStatus.providerName || getProviderDisplayName(emailStatus.provider || '')}
                  </span>
                  {isUsingManagedEmail && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      <Shield className="w-3 h-3 mr-1" />
                      Platform
                    </Badge>
                  )}
                </div>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Provider:</span>{' '}
                    <span className="font-medium">
                      {emailStatus.providerName || getProviderDisplayName(emailStatus.provider || '')}
                    </span>
                  </div>

                  {/* Managed Email Info */}
                  {isUsingManagedEmail && (
                    <>
                      <div className="flex items-center text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          Platform-managed with automatic configuration
                        </span>
                      </div>
                      <div className="flex items-center text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          No API keys or SMTP settings required
                        </span>
                      </div>
                    </>
                  )}

                  {/* Provider-specific info (not shown for managed email) */}
                  {!isUsingManagedEmail && (
                    <>
                      {/* SMTP-specific info */}
                      {emailStatus.provider === 'smtp' && emailStatus.host && (
                        <div>
                          <span className="text-muted-foreground">Host:</span>{' '}
                          <span className="font-mono">
                            {emailStatus.host}:{emailStatus.port}
                          </span>
                          {emailStatus.secure && (
                            <span className="ml-2 text-xs text-muted-foreground">(SSL/TLS)</span>
                          )}
                        </div>
                      )}

                      {emailStatus.provider === 'smtp' && emailStatus.user && (
                        <div>
                          <span className="text-muted-foreground">User:</span>{' '}
                          <span className="font-mono">{emailStatus.user}</span>
                        </div>
                      )}

                      {/* API key based providers */}
                      {emailStatus.provider !== 'smtp' && emailStatus.apiKey && (
                        <div>
                          <span className="text-muted-foreground">API Key:</span>{' '}
                          <span className="font-mono">{emailStatus.apiKey}</span>
                        </div>
                      )}

                      {emailStatus.fromAddress && (
                        <div>
                          <span className="text-muted-foreground">From:</span>{' '}
                          <span className="font-mono">
                            {emailStatus.fromName && `"${emailStatus.fromName}" `}
                            &lt;{emailStatus.fromAddress}&gt;
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={handleStartEditing}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Configuration
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowSendTest(!showSendTest)}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Test Email
                  </Button>
                </div>

                {/* Send Test Email Panel */}
                {showSendTest && (
                  <div className="mt-4 p-4 bg-muted/50 rounded-lg space-y-3">
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="recipient@example.com"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleSendTestEmail}
                        disabled={isSendingTest || !testEmailAddress.includes('@')}
                      >
                        {isSendingTest ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-2" />
                            Send
                          </>
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={handleCloseSendTest}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>

                    {sendTestResult && (
                      <Alert variant={sendTestResult.success ? 'default' : 'destructive'}>
                        {sendTestResult.success ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        <AlertDescription>
                          {sendTestResult.message}
                          {sendTestResult.messageId && (
                            <span className="block text-xs text-muted-foreground mt-1">
                              Message ID: {sendTestResult.messageId}
                            </span>
                          )}
                          {sendTestResult.error && (
                            <span className="block mt-1 text-xs">{sendTestResult.error}</span>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
                  <span className="text-muted-foreground">Email not configured</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Password reset emails will not work until email is configured.
                </p>
                <Button onClick={handleStartEditing}>Configure Email</Button>
              </div>
            )}
          </>
        ) : (
          // Edit mode
          <div className="space-y-4">
            {/* Provider Selection */}
            <div>
              <Label className="mb-2 block">Email Provider</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Managed Email Option (Platform) */}
                {enableManagedEmail && (
                  <button
                    type="button"
                    onClick={() => setSelectedProvider('managed' as SettingsEmailProvider)}
                    className={`p-3 border rounded-lg text-left transition-colors ${
                      selectedProvider === 'managed'
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      <span className="font-medium text-sm">Managed Email</span>
                      <Badge variant="secondary" className="text-xs py-0 px-1.5">
                        Platform
                      </Badge>
                    </div>
                    <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded mt-1">
                      <Zap className="w-3 h-3 mr-1" />
                      Recommended
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Platform-managed with automatic configuration
                    </p>
                  </button>
                )}
                {implementedProviders.map((provider: EmailProviderInfo) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProvider(provider.id as SettingsEmailProvider)}
                    className={`p-3 border rounded-lg text-left transition-colors ${
                      selectedProvider === provider.id
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="font-medium text-sm">{provider.name}</div>
                    {provider.recommended && !enableManagedEmail && (
                      <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded mt-1">
                        <Zap className="w-3 h-3 mr-1" />
                        Recommended
                      </span>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{provider.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Provider-specific form */}
            {selectedProvider && (
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                {/* Managed Email Info */}
                {selectedProvider === 'managed' && (
                  <div className="space-y-3">
                    <div className="flex items-center">
                      <Shield className="w-5 h-5 text-primary mr-3" />
                      <div>
                        <h4 className="font-medium">Platform Managed Email</h4>
                        <p className="text-sm text-muted-foreground">
                          Email is automatically configured and managed by the platform
                        </p>
                      </div>
                    </div>

                    <div className="border-t pt-3">
                      <div className="flex items-center text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          Pre-configured email service with platform credentials
                        </span>
                      </div>
                      <div className="flex items-center text-sm mt-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          No API keys or SMTP settings required
                        </span>
                      </div>
                      <div className="flex items-center text-sm mt-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                        <span className="text-muted-foreground">
                          Password reset and notifications work out of the box
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SMTP Form */}
                {selectedProvider === 'smtp' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="smtp-host">SMTP Host</Label>
                        <Input
                          id="smtp-host"
                          value={smtpConfig.host}
                          onChange={(e) => setSmtpConfig({ ...smtpConfig, host: e.target.value })}
                          placeholder="smtp.gmail.com"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="smtp-port">Port</Label>
                        <Input
                          id="smtp-port"
                          type="number"
                          value={smtpConfig.port}
                          onChange={(e) =>
                            setSmtpConfig({ ...smtpConfig, port: parseInt(e.target.value) || 587 })
                          }
                          placeholder="587"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="smtp-user">Username</Label>
                        <Input
                          id="smtp-user"
                          value={smtpConfig.user}
                          onChange={(e) => setSmtpConfig({ ...smtpConfig, user: e.target.value })}
                          placeholder="your@email.com"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="smtp-password">Password</Label>
                        <Input
                          id="smtp-password"
                          type="password"
                          value={smtpConfig.password}
                          onChange={(e) =>
                            setSmtpConfig({ ...smtpConfig, password: e.target.value })
                          }
                          placeholder="App password"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="smtp-secure"
                        checked={smtpConfig.secure}
                        onCheckedChange={(checked) =>
                          setSmtpConfig({ ...smtpConfig, secure: !!checked })
                        }
                      />
                      <Label htmlFor="smtp-secure" className="text-sm font-normal">
                        Use SSL/TLS (port 465)
                      </Label>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                      <div>
                        <Label htmlFor="smtp-from-address">From Address</Label>
                        <Input
                          id="smtp-from-address"
                          value={smtpConfig.fromAddress}
                          onChange={(e) =>
                            setSmtpConfig({ ...smtpConfig, fromAddress: e.target.value })
                          }
                          placeholder="noreply@example.com"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="smtp-from-name">From Name (optional)</Label>
                        <Input
                          id="smtp-from-name"
                          value={smtpConfig.fromName}
                          onChange={(e) =>
                            setSmtpConfig({ ...smtpConfig, fromName: e.target.value })
                          }
                          placeholder="Static Asset Platform"
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* API Key based providers (SendGrid, Resend, etc.) */}
                {selectedProvider !== 'smtp' && (
                  <>
                    <div>
                      <Label htmlFor="api-key">API Key</Label>
                      <Input
                        id="api-key"
                        type="password"
                        value={apiKeyConfig.apiKey}
                        onChange={(e) =>
                          setApiKeyConfig({ ...apiKeyConfig, apiKey: e.target.value })
                        }
                        placeholder={
                          selectedProvider === 'sendgrid'
                            ? 'SG.xxxxxxxxxx'
                            : selectedProvider === 'resend'
                              ? 're_xxxxxxxxxx'
                              : 'Your API key'
                        }
                        className="mt-1"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedProvider === 'sendgrid' &&
                          'Create an API key with "Mail Send" permissions in your SendGrid dashboard'}
                        {selectedProvider === 'resend' && 'Get your API key from the Resend dashboard'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                      <div>
                        <Label htmlFor="api-from-address">From Address</Label>
                        <Input
                          id="api-from-address"
                          value={apiKeyConfig.fromAddress}
                          onChange={(e) =>
                            setApiKeyConfig({ ...apiKeyConfig, fromAddress: e.target.value })
                          }
                          placeholder="noreply@example.com"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="api-from-name">From Name (optional)</Label>
                        <Input
                          id="api-from-name"
                          value={apiKeyConfig.fromName}
                          onChange={(e) =>
                            setApiKeyConfig({ ...apiKeyConfig, fromName: e.target.value })
                          }
                          placeholder="Static Asset Platform"
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <Alert variant={testResult.success ? 'default' : 'destructive'}>
                {testResult.success ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertDescription>
                  {testResult.message}
                  {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
                  {testResult.error && (
                    <span className="block mt-1 text-xs">{testResult.error}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Update Error */}
            {updateError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{updateError}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!isFormValid() || isUpdating || isTesting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
              <Button onClick={handleSave} disabled={!isFormValid() || isUpdating || isTesting}>
                {isUpdating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
