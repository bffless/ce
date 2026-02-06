import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useGetEmailProvidersQuery,
  useGetAvailableOptionsQuery,
  useConfigureEmailMutation,
  useTestEmailMutation,
  EmailProvider,
  EmailConfig,
  SmtpEmailConfig,
  SendGridEmailConfig,
  ResendEmailConfig,
} from '@/services/setupApi';
import {
  nextWizardStep,
  prevWizardStep,
  setEmailConfigured,
  setEmailSkipped,
  setWizardError,
} from '@/store/slices/setupSlice';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Mail,
  AlertTriangle,
  ExternalLink,
  Zap,
  Shield,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type ConfigMode = 'provider' | 'skip';

export function EmailStep() {
  const dispatch = useDispatch();
  const { emailConfigured } = useSelector((state: RootState) => state.setup.wizard);

  const [configMode, setConfigMode] = useState<ConfigMode>('provider');
  const [selectedProvider, setSelectedProvider] = useState<EmailProvider | null>(null);
  const [connectionTested, setConnectionTested] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);

  // Provider-specific config state
  const [smtpConfig, setSmtpConfig] = useState<SmtpEmailConfig>({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  const [sendGridConfig, setSendGridConfig] = useState<SendGridEmailConfig>({
    apiKey: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  const [resendConfig, setResendConfig] = useState<ResendEmailConfig>({
    apiKey: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  const { data: providersData, isLoading: isLoadingProviders } = useGetEmailProvidersQuery();
  const { data: availableOptions, isLoading: isLoadingOptions } = useGetAvailableOptionsQuery();
  const [configureEmail, { isLoading: isConfiguring }] = useConfigureEmailMutation();
  const [testEmail, { isLoading: isTesting }] = useTestEmailMutation();

  // Get email options from feature flags
  const emailOptions = availableOptions?.email;
  const shouldSkipStep = emailOptions?.skipStep ?? false;
  const defaultEmailType = emailOptions?.defaultType || '';
  const enableManagedEmail = emailOptions?.managed ?? false;
  const enableSmtp = emailOptions?.smtp ?? true;
  const enableSendGrid = emailOptions?.sendgrid ?? true;
  const enableResend = emailOptions?.resend ?? true;
  // Don't allow skipping when managed email is available (no configuration needed)
  const enableSkipOption = (emailOptions?.skipAllowed ?? true) && !enableManagedEmail;

  // Filter to only show implemented providers based on feature flags
  // Note: 'managed' is excluded since we have a custom card for it
  const implementedProviders = (providersData?.providers.filter((p) => {
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
        return false; // Handled by custom "Managed Email" card
      default:
        return true;
    }
  }) || []);

  // Auto-select managed email or first recommended provider
  useEffect(() => {
    if (!selectedProvider) {
      if (enableManagedEmail) {
        setSelectedProvider('managed');
      } else if (defaultEmailType && defaultEmailType !== 'managed') {
        setSelectedProvider(defaultEmailType as EmailProvider);
      } else if (implementedProviders.length > 0) {
        const recommended = implementedProviders.find((p) => p.recommended);
        setSelectedProvider((recommended?.id || implementedProviders[0]?.id) as EmailProvider);
      }
    }
  }, [enableManagedEmail, defaultEmailType, implementedProviders, selectedProvider]);


  const getConfigForProvider = (): EmailConfig | null => {
    switch (selectedProvider) {
      case 'managed':
        return {} as EmailConfig; // Managed email uses platform credentials
      case 'smtp':
        return smtpConfig;
      case 'sendgrid':
        return sendGridConfig;
      case 'resend':
        return resendConfig;
      default:
        return null;
    }
  };

  const isConfigValid = (): boolean => {
    // Managed email is always valid (uses platform credentials)
    if (selectedProvider === 'managed') return true;

    const config = getConfigForProvider();
    if (!config) return false;

    // Common validation
    if (!('fromAddress' in config) || !config.fromAddress) return false;

    switch (selectedProvider) {
      case 'smtp':
        const smtp = config as SmtpEmailConfig;
        return !!(smtp.host && smtp.port);
      case 'sendgrid':
        const sg = config as SendGridEmailConfig;
        return !!sg.apiKey;
      case 'resend':
        const rs = config as ResendEmailConfig;
        return !!rs.apiKey;
      default:
        return false;
    }
  };

  const handleConfigureAndTest = async () => {
    if (!selectedProvider) return;

    const config = getConfigForProvider();
    if (!config) return;

    try {
      dispatch(setWizardError(null));
      setConnectionTested(false);
      setConnectionSuccess(false);
      setTestLatency(null);

      // Configure email provider
      await configureEmail({ provider: selectedProvider, config }).unwrap();

      // For managed email, skip the test (it uses platform credentials)
      if (selectedProvider === 'managed') {
        setConnectionTested(true);
        setConnectionSuccess(true);
        dispatch(setEmailConfigured(true));
        return;
      }

      // Test connection for non-managed providers
      const result = await testEmail().unwrap();
      setConnectionTested(true);
      setConnectionSuccess(result.success);
      setTestLatency(result.latencyMs || null);

      if (result.success) {
        dispatch(setEmailConfigured(true));
      } else {
        dispatch(setWizardError(result.error || 'Email connection test failed'));
      }
    } catch (error: unknown) {
      setConnectionTested(true);
      setConnectionSuccess(false);
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to configure email provider'));
    }
  };

  const handleSkip = () => {
    dispatch(setEmailSkipped(true));
    dispatch(nextWizardStep());
  };

  const handleContinue = () => {
    dispatch(nextWizardStep());
  };

  if (isLoadingProviders || isLoadingOptions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If we should skip this step, show a read-only pre-configured view
  if (shouldSkipStep) {
    const emailTypeName = enableManagedEmail ? 'Platform Managed Email' :
                          defaultEmailType === 'sendgrid' ? 'SendGrid' :
                          defaultEmailType === 'resend' ? 'Resend' :
                          defaultEmailType === 'smtp' ? 'SMTP' : 'Skipped';

    const handleSkipContinue = async () => {
      if (enableManagedEmail) {
        // Auto-configure managed email
        try {
          await configureEmail({ provider: 'managed' as EmailProvider, config: {} }).unwrap();
          dispatch(setEmailConfigured(true));
          dispatch(nextWizardStep());
        } catch {
          dispatch(setWizardError('Failed to configure email'));
        }
      } else {
        // Skip without configuring
        dispatch(setEmailSkipped(true));
        dispatch(nextWizardStep());
      }
    };

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">Email Configuration</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {enableManagedEmail
              ? 'Email has been pre-configured for this workspace.'
              : 'Email configuration is optional for this workspace.'}
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              {enableManagedEmail ? (
                <CheckCircle className="w-5 h-5 text-primary" />
              ) : (
                <Mail className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">{emailTypeName}</p>
              <p className="text-sm text-muted-foreground">
                {enableManagedEmail
                  ? 'Platform-managed email service with automatic configuration'
                  : 'You can configure email later in settings if needed'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
            Back
          </Button>
          <Button onClick={handleSkipContinue} disabled={isConfiguring}>
            {isConfiguring ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </div>
    );
  }

  const selectedProviderInfo = implementedProviders.find((p) => p.id === selectedProvider);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Email Configuration</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure email for password reset and notifications. HTTP-based providers (SendGrid,
          Resend) work on cloud platforms where SMTP ports are blocked.
        </p>
      </div>

      {/* Configuration Mode Selection */}
      <div className="space-y-3">
        {/* Provider Selection */}
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            configMode === 'provider'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="configMode"
            value="provider"
            checked={configMode === 'provider'}
            onChange={() => setConfigMode('provider')}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <div className="flex items-center">
              <Mail className="w-4 h-4 mr-2 text-muted-foreground" />
              <span className="font-medium">Configure Email Provider</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose from SMTP, SendGrid, Resend, and more
            </p>
          </div>
        </label>

        {/* Skip Option */}
        {enableSkipOption && (
          <label
            className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
              configMode === 'skip'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            <input
              type="radio"
              name="configMode"
              value="skip"
              checked={configMode === 'skip'}
              onChange={() => setConfigMode('skip')}
              className="mt-1 mr-3"
            />
            <div className="flex-1">
              <div className="flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500" />
                <span className="font-medium">Skip for Now</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Password reset emails will not work until email is configured
              </p>
            </div>
          </label>
        )}
      </div>

      {/* Provider Selection and Configuration */}
      {configMode === 'provider' && (
        <div className="space-y-4">
          {/* Provider Cards - Vertical Layout */}
          <div className="space-y-2">
            {/* Managed Email (Platform) */}
            {enableManagedEmail && (
              <button
                type="button"
                onClick={() => {
                  setSelectedProvider('managed');
                  setConnectionTested(false);
                  setConnectionSuccess(false);
                }}
                className={`w-full p-4 border rounded-lg text-left transition-colors ${
                  selectedProvider === 'managed'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">Managed Email</span>
                        <Badge variant="secondary" className="text-xs py-0 px-1.5">
                          Platform
                        </Badge>
                        <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                          <Zap className="w-3 h-3 mr-1" />
                          Recommended
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Platform-managed email with automatic configuration. No setup required.
                      </p>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 ${
                    selectedProvider === 'managed'
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/30'
                  }`}>
                    {selectedProvider === 'managed' && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )}

            {implementedProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  setSelectedProvider(provider.id);
                  setConnectionTested(false);
                  setConnectionSuccess(false);
                }}
                className={`w-full p-4 border rounded-lg text-left transition-colors ${
                  selectedProvider === provider.id
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{provider.name}</span>
                        {provider.recommended && !enableManagedEmail && (
                          <span className="inline-flex items-center text-xs bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                            <Zap className="w-3 h-3 mr-1" />
                            Recommended
                          </span>
                        )}
                        {provider.requiresPorts && (
                          <span className="text-xs text-yellow-600 dark:text-yellow-400">
                            Uses SMTP ports
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 ${
                    selectedProvider === provider.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/30'
                  }`}>
                    {selectedProvider === provider.id && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Provider Warning (for SMTP) */}
          {selectedProvider === 'smtp' && selectedProviderInfo?.warning && (
            <div className="flex items-start p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-300">
                  Cloud Hosting Notice
                </h4>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                  {selectedProviderInfo.warning}
                </p>
              </div>
            </div>
          )}

          {/* Managed Email Info */}
          {selectedProvider === 'managed' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
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

          {/* Provider-Specific Configuration Form */}
          {selectedProvider && selectedProvider !== 'managed' && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              {/* Documentation Link */}
              {selectedProviderInfo?.docsUrl && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  <a
                    href={selectedProviderInfo.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    View {selectedProviderInfo.name} documentation
                  </a>
                </div>
              )}

              {/* SMTP Form */}
              {selectedProvider === 'smtp' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="host">SMTP Host</Label>
                      <Input
                        id="host"
                        value={smtpConfig.host}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, host: e.target.value })}
                        placeholder="smtp.gmail.com"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="port">Port</Label>
                      <Input
                        id="port"
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
                      <Label htmlFor="user">Username</Label>
                      <Input
                        id="user"
                        value={smtpConfig.user || ''}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, user: e.target.value })}
                        placeholder="your@email.com"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={smtpConfig.password || ''}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, password: e.target.value })}
                        placeholder="App password"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="secure"
                      checked={smtpConfig.secure}
                      onCheckedChange={(checked) =>
                        setSmtpConfig({ ...smtpConfig, secure: !!checked })
                      }
                    />
                    <Label htmlFor="secure" className="text-sm font-normal">
                      Use SSL/TLS (port 465)
                    </Label>
                  </div>
                </>
              )}

              {/* SendGrid Form */}
              {selectedProvider === 'sendgrid' && (
                <div>
                  <Label htmlFor="sendgrid-apiKey">API Key</Label>
                  <Input
                    id="sendgrid-apiKey"
                    type="password"
                    value={sendGridConfig.apiKey}
                    onChange={(e) =>
                      setSendGridConfig({ ...sendGridConfig, apiKey: e.target.value })
                    }
                    placeholder="SG.xxxxxxxxxxxxxxxxxx"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create an API key with "Mail Send" permissions in your SendGrid dashboard
                  </p>
                </div>
              )}

              {/* Resend Form */}
              {selectedProvider === 'resend' && (
                <div>
                  <Label htmlFor="resend-apiKey">API Key</Label>
                  <Input
                    id="resend-apiKey"
                    type="password"
                    value={resendConfig.apiKey}
                    onChange={(e) => setResendConfig({ ...resendConfig, apiKey: e.target.value })}
                    placeholder="re_xxxxxxxxxxxxxxxxxx"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Get your API key from the Resend dashboard
                  </p>
                </div>
              )}

              {/* Common: From Address */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <Label htmlFor="fromAddress">From Address</Label>
                  <Input
                    id="fromAddress"
                    type="email"
                    value={
                      selectedProvider === 'smtp'
                        ? smtpConfig.fromAddress
                        : selectedProvider === 'sendgrid'
                          ? sendGridConfig.fromAddress
                          : resendConfig.fromAddress
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (selectedProvider === 'smtp') {
                        setSmtpConfig({ ...smtpConfig, fromAddress: value });
                      } else if (selectedProvider === 'sendgrid') {
                        setSendGridConfig({ ...sendGridConfig, fromAddress: value });
                      } else if (selectedProvider === 'resend') {
                        setResendConfig({ ...resendConfig, fromAddress: value });
                      }
                    }}
                    placeholder="noreply@example.com"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="fromName">From Name (optional)</Label>
                  <Input
                    id="fromName"
                    value={
                      selectedProvider === 'smtp'
                        ? smtpConfig.fromName || ''
                        : selectedProvider === 'sendgrid'
                          ? sendGridConfig.fromName || ''
                          : resendConfig.fromName || ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (selectedProvider === 'smtp') {
                        setSmtpConfig({ ...smtpConfig, fromName: value });
                      } else if (selectedProvider === 'sendgrid') {
                        setSendGridConfig({ ...sendGridConfig, fromName: value });
                      } else if (selectedProvider === 'resend') {
                        setResendConfig({ ...resendConfig, fromName: value });
                      }
                    }}
                    placeholder="Static Asset Platform"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Connection Test Result */}
      {connectionTested && (
        <div
          className={`flex items-center p-4 rounded-md ${
            connectionSuccess
              ? 'bg-green-500/10 border border-green-500/20'
              : 'bg-destructive/10 border border-destructive/20'
          }`}
        >
          {connectionSuccess ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              <span className="text-green-700 dark:text-green-400">
                Email connection successful!
                {testLatency && ` (${testLatency}ms)`}
              </span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-destructive mr-2" />
              <span className="text-destructive">
                Email connection failed. Check your configuration.
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>

        <div className="space-x-2">
          {configMode === 'skip' ? (
            <Button onClick={handleSkip}>Skip & Continue</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleConfigureAndTest}
                disabled={isConfiguring || isTesting || !isConfigValid()}
              >
                {isConfiguring || isTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>

              <Button onClick={handleContinue} disabled={!connectionSuccess && !emailConfigured}>
                Continue
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
