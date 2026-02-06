import { useState, useEffect } from 'react';
import {
  useGetSmtpStatusQuery,
  useUpdateSmtpMutation,
  useTestSmtpSettingsMutation,
  UpdateSmtpDto,
} from '@/services/settingsApi';
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
} from 'lucide-react';

export function SmtpSettings() {
  const { data: smtpStatus, isLoading: isLoadingStatus } = useGetSmtpStatusQuery();
  const [updateSmtp, { isLoading: isUpdating }] = useUpdateSmtpMutation();
  const [testSmtp, { isLoading: isTesting }] = useTestSmtpSettingsMutation();

  const [isEditing, setIsEditing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; error?: string } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [formData, setFormData] = useState<UpdateSmtpDto>({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromAddress: '',
    fromName: 'Static Asset Platform',
  });

  // Initialize form when status loads and user starts editing
  useEffect(() => {
    if (smtpStatus?.isConfigured && isEditing) {
      setFormData({
        host: smtpStatus.host || '',
        port: smtpStatus.port || 587,
        secure: smtpStatus.secure || false,
        user: '', // Don't populate user - it's masked
        password: '',
        fromAddress: smtpStatus.fromAddress || '',
        fromName: smtpStatus.fromName || 'Static Asset Platform',
      });
    }
  }, [smtpStatus, isEditing]);

  const handleStartEditing = () => {
    setIsEditing(true);
    setTestResult(null);
    setUpdateError(null);
    // Pre-populate form with current values (except credentials)
    if (smtpStatus?.isConfigured) {
      setFormData({
        host: smtpStatus.host || '',
        port: smtpStatus.port || 587,
        secure: smtpStatus.secure || false,
        user: '',
        password: '',
        fromAddress: smtpStatus.fromAddress || '',
        fromName: smtpStatus.fromName || 'Static Asset Platform',
      });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTestResult(null);
    setUpdateError(null);
    setFormData({
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      fromAddress: '',
      fromName: 'Static Asset Platform',
    });
  };

  const handleSave = async () => {
    try {
      setUpdateError(null);
      await updateSmtp(formData).unwrap();
      setIsEditing(false);
      setTestResult(null);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setUpdateError(err.data?.message || 'Failed to update SMTP configuration');
    }
  };

  const handleTest = async () => {
    try {
      setTestResult(null);
      // First save the config
      await updateSmtp(formData).unwrap();
      // Then test
      const result = await testSmtp().unwrap();
      setTestResult(result);
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      setTestResult({
        success: false,
        message: 'Failed to test SMTP',
        error: err.data?.message || 'Unknown error',
      });
    }
  };

  const isFormValid = formData.host && formData.port && formData.user && formData.password;

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
          Configure SMTP for password reset emails and notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isEditing ? (
          // View mode
          <>
            {smtpStatus?.isConfigured ? (
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                  <span className="text-muted-foreground">SMTP configured</span>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Host:</span>{' '}
                    <span className="font-mono">{smtpStatus.host}:{smtpStatus.port}</span>
                    {smtpStatus.secure && <span className="ml-2 text-xs text-muted-foreground">(SSL/TLS)</span>}
                  </div>
                  <div>
                    <span className="text-muted-foreground">User:</span>{' '}
                    <span className="font-mono">{smtpStatus.user}</span>
                  </div>
                  {smtpStatus.fromAddress && (
                    <div>
                      <span className="text-muted-foreground">From:</span>{' '}
                      <span className="font-mono">
                        {smtpStatus.fromName && `"${smtpStatus.fromName}" `}
                        &lt;{smtpStatus.fromAddress}&gt;
                      </span>
                    </div>
                  )}
                </div>
                <Button variant="outline" onClick={handleStartEditing}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Configuration
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mr-2" />
                  <span className="text-muted-foreground">SMTP not configured</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Password reset emails will not work until SMTP is configured.
                </p>
                <Button onClick={handleStartEditing}>
                  Configure SMTP
                </Button>
              </div>
            )}
          </>
        ) : (
          // Edit mode
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="smtp-host">SMTP Host</Label>
                <Input
                  id="smtp-host"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 587 })}
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
                  value={formData.user}
                  onChange={(e) => setFormData({ ...formData, user: e.target.value })}
                  placeholder="your@email.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="smtp-password">Password</Label>
                <Input
                  id="smtp-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="App password"
                  className="mt-1"
                />
                {formData.host.toLowerCase().includes('gmail') && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    For Gmail, use an App Password without spaces
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="smtp-secure"
                checked={formData.secure}
                onCheckedChange={(checked) => setFormData({ ...formData, secure: !!checked })}
              />
              <Label htmlFor="smtp-secure" className="text-sm font-normal">
                Use SSL/TLS (port 465)
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="smtp-from-address">From Address (optional)</Label>
                <Input
                  id="smtp-from-address"
                  value={formData.fromAddress}
                  onChange={(e) => setFormData({ ...formData, fromAddress: e.target.value })}
                  placeholder="noreply@example.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="smtp-from-name">From Name (optional)</Label>
                <Input
                  id="smtp-from-name"
                  value={formData.fromName}
                  onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
                  placeholder="Static Asset Platform"
                  className="mt-1"
                />
              </div>
            </div>

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
                disabled={!isFormValid || isUpdating || isTesting}
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
              <Button
                onClick={handleSave}
                disabled={!isFormValid || isUpdating || isTesting}
              >
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
