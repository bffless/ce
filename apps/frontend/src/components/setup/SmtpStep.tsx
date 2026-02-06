import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useGetEnvSmtpConfigQuery,
  useConfigureSmtpFromEnvMutation,
  useConfigureSmtpMutation,
  useTestSmtpMutation,
  SmtpConfig,
} from '@/services/setupApi';
import {
  nextWizardStep,
  prevWizardStep,
  setSmtpConfigured,
  setSmtpSkipped,
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
  Settings2,
} from 'lucide-react';

type ConfigMode = 'env' | 'manual' | 'skip';

export function SmtpStep() {
  const dispatch = useDispatch();
  const { smtpConfigured } = useSelector((state: RootState) => state.setup.wizard);

  const [configMode, setConfigMode] = useState<ConfigMode>('env');
  const [connectionTested, setConnectionTested] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState(false);

  // Manual SMTP config state
  const [manualConfig, setManualConfig] = useState<SmtpConfig>({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  const { data: envConfig, isLoading: isLoadingEnvConfig } = useGetEnvSmtpConfigQuery();
  const [configureFromEnv, { isLoading: isConfiguringEnv }] = useConfigureSmtpFromEnvMutation();
  const [configureSmtp, { isLoading: isConfiguringManual }] = useConfigureSmtpMutation();
  const [testSmtp, { isLoading: isTesting }] = useTestSmtpMutation();

  const isConfiguring = isConfiguringEnv || isConfiguringManual;

  const handleConfigureAndTest = async () => {
    try {
      dispatch(setWizardError(null));
      setConnectionTested(false);
      setConnectionSuccess(false);

      if (configMode === 'env') {
        await configureFromEnv().unwrap();
      } else if (configMode === 'manual') {
        await configureSmtp({ config: manualConfig }).unwrap();
      }

      // Test connection
      const result = await testSmtp().unwrap();
      setConnectionTested(true);
      setConnectionSuccess(result.success);

      if (result.success) {
        dispatch(setSmtpConfigured(true));
      } else {
        dispatch(setWizardError(result.error || 'SMTP connection test failed'));
      }
    } catch (error: unknown) {
      setConnectionTested(true);
      setConnectionSuccess(false);
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to configure SMTP'));
    }
  };

  const handleSkip = () => {
    dispatch(setSmtpSkipped(true));
    dispatch(nextWizardStep());
  };

  const handleContinue = () => {
    dispatch(nextWizardStep());
  };

  if (isLoadingEnvConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const envSmtpAvailable = envConfig?.isConfigured;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Email Configuration</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure SMTP for password reset emails and notifications.
        </p>
      </div>

      {/* Configuration Mode Selection */}
      <div className="space-y-3">
        {/* Environment Config Option */}
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            configMode === 'env'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          } ${!envSmtpAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input
            type="radio"
            name="configMode"
            value="env"
            checked={configMode === 'env'}
            onChange={() => setConfigMode('env')}
            disabled={!envSmtpAvailable}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <div className="flex items-center">
              <Mail className="w-4 h-4 mr-2 text-muted-foreground" />
              <span className="font-medium">Use Environment Variables</span>
              {envSmtpAvailable && (
                <span className="ml-2 text-xs bg-green-500/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                  Detected
                </span>
              )}
            </div>
            {envSmtpAvailable ? (
              <div className="mt-2 text-sm text-muted-foreground space-y-1">
                <div>Host: <span className="font-mono">{envConfig.host}:{envConfig.port}</span></div>
                <div>User: <span className="font-mono">{envConfig.user}</span></div>
                {envConfig.fromAddress && (
                  <div>From: <span className="font-mono">{envConfig.fromAddress}</span></div>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                SMTP not configured in environment variables
              </p>
            )}
          </div>
        </label>

        {/* Manual Config Option */}
        <label
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            configMode === 'manual'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="configMode"
            value="manual"
            checked={configMode === 'manual'}
            onChange={() => setConfigMode('manual')}
            className="mt-1 mr-3"
          />
          <div className="flex-1">
            <div className="flex items-center">
              <Settings2 className="w-4 h-4 mr-2 text-muted-foreground" />
              <span className="font-medium">Configure Manually</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter SMTP server details manually
            </p>
          </div>
        </label>

        {/* Skip Option */}
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
              Password reset emails will not work until SMTP is configured
            </p>
          </div>
        </label>
      </div>

      {/* Manual Configuration Form */}
      {configMode === 'manual' && (
        <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="host">SMTP Host</Label>
              <Input
                id="host"
                value={manualConfig.host}
                onChange={(e) => setManualConfig({ ...manualConfig, host: e.target.value })}
                placeholder="smtp.gmail.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={manualConfig.port}
                onChange={(e) => setManualConfig({ ...manualConfig, port: parseInt(e.target.value) || 587 })}
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
                value={manualConfig.user}
                onChange={(e) => setManualConfig({ ...manualConfig, user: e.target.value })}
                placeholder="your@email.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={manualConfig.password}
                onChange={(e) => setManualConfig({ ...manualConfig, password: e.target.value })}
                placeholder="App password"
                className="mt-1"
              />
              {manualConfig.host.toLowerCase().includes('gmail') && (
                <p className="mt-1 text-xs text-muted-foreground">
                  For Gmail, use an App Password without spaces (Google displays them with spaces for readability)
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="secure"
              checked={manualConfig.secure}
              onCheckedChange={(checked) => setManualConfig({ ...manualConfig, secure: !!checked })}
            />
            <Label htmlFor="secure" className="text-sm font-normal">
              Use SSL/TLS (port 465)
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="fromAddress">From Address (optional)</Label>
              <Input
                id="fromAddress"
                value={manualConfig.fromAddress}
                onChange={(e) => setManualConfig({ ...manualConfig, fromAddress: e.target.value })}
                placeholder="noreply@example.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="fromName">From Name (optional)</Label>
              <Input
                id="fromName"
                value={manualConfig.fromName}
                onChange={(e) => setManualConfig({ ...manualConfig, fromName: e.target.value })}
                placeholder="Static Asset Platform"
                className="mt-1"
              />
            </div>
          </div>
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
              <span className="text-green-700 dark:text-green-400">SMTP connection successful!</span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-destructive mr-2" />
              <span className="text-destructive">
                SMTP connection failed. Check your credentials.
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
            <Button onClick={handleSkip}>
              Skip & Continue
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleConfigureAndTest}
                disabled={
                  isConfiguring ||
                  isTesting ||
                  (configMode === 'env' && !envSmtpAvailable) ||
                  (configMode === 'manual' && (!manualConfig.host || !manualConfig.user || !manualConfig.password))
                }
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

              <Button
                onClick={handleContinue}
                disabled={!connectionSuccess && !smtpConfigured}
              >
                Continue
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
