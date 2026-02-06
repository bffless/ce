import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  useCompleteSetupMutation,
  useGetSetupStatusQuery,
  useGetConstraintsQuery,
  useGetCacheConfigQuery,
  useGetAvailableOptionsQuery,
} from '@/services/setupApi';
import { prevWizardStep, setWizardError } from '@/store/slices/setupSlice';
import { RootState } from '@/store';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, AlertTriangle, Loader2, Lightbulb } from 'lucide-react';

const getStorageProviderLabel = (provider: string | null) => {
  switch (provider) {
    case 'minio':
      return 'MinIO';
    case 'local':
      return 'Local Filesystem';
    case 's3':
      return 'S3 Storage';
    case 'gcs':
      return 'Google Cloud Storage';
    case 'azure':
      return 'Azure Blob Storage';
    default:
      return provider || 'Not configured';
  }
};

export function CompleteStep() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { adminEmail, smtpConfigured, smtpSkipped } = useSelector(
    (state: RootState) => state.setup.wizard
  );

  const { data: setupStatus } = useGetSetupStatusQuery();
  const { data: constraints } = useGetConstraintsQuery();
  const { data: cacheConfig } = useGetCacheConfigQuery();
  const { data: availableOptions } = useGetAvailableOptionsQuery();
  const [completeSetup, { isLoading }] = useCompleteSetupMutation();

  // UI display flags
  const showEnvOptimizationHints = availableOptions?.ui?.enableEnvOptimizationHints ?? true;
  const showSettingsUpdateNote = availableOptions?.ui?.enableSettingsUpdateNote ?? true;

  // Calculate optimization recommendations
  const recommendations = useMemo(() => {
    const recs: Array<{ flag: string; savings: string; reason: string }> = [];

    // If user selected non-MinIO storage but MinIO is still enabled
    if (setupStatus?.storageProvider !== 'minio' && constraints?.minio.enabled) {
      recs.push({
        flag: 'ENABLE_MINIO=false',
        savings: '~128MB RAM',
        reason: `You're using ${getStorageProviderLabel(setupStatus?.storageProvider || null)} storage`,
      });
    }

    // If using memory cache but Redis is still enabled
    if (cacheConfig?.type === 'memory' && constraints?.redis.enabled) {
      recs.push({
        flag: 'ENABLE_REDIS=false',
        savings: '~96MB RAM',
        reason: "You're using in-memory caching",
      });
    }

    return recs;
  }, [setupStatus, constraints, cacheConfig]);

  const totalSavings = useMemo(() => {
    return recommendations.reduce((sum, r) => {
      const match = r.savings.match(/\d+/);
      const mb = parseInt(match?.[0] || '0');
      return sum + mb;
    }, 0);
  }, [recommendations]);

  const handleComplete = async () => {
    try {
      dispatch(setWizardError(null));
      await completeSetup({ confirm: true }).unwrap();
      navigate('/login');
    } catch (error: unknown) {
      const err = error as { data?: { message?: string } };
      dispatch(setWizardError(err.data?.message || 'Failed to complete setup'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Complete Setup</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your configuration and complete the setup.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center">
          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
          <span className="text-sm">
            Admin account created: <strong>{adminEmail}</strong>
          </span>
        </div>

        <div className="flex items-center">
          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
          <span className="text-sm">
            Storage configured: <strong>{getStorageProviderLabel(setupStatus?.storageProvider || null)}</strong>
          </span>
        </div>

        <div className="flex items-center">
          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
          <span className="text-sm">Storage connection verified</span>
        </div>

        <div className="flex items-center">
          {smtpConfigured ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              <span className="text-sm">Email configured</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-yellow-500 mr-2" />
              <span className="text-sm text-yellow-700 dark:text-yellow-500">
                Email not configured {smtpSkipped && '(skipped)'}
              </span>
            </>
          )}
        </div>
      </div>

      {showSettingsUpdateNote && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-400">
            <strong>Note:</strong> Storage and email settings can be updated later in Settings.
          </p>
        </div>
      )}

      {/* Optimization Recommendations */}
      {showEnvOptimizationHints && recommendations.length > 0 && (
        <Alert>
          <Lightbulb className="h-4 w-4" />
          <AlertTitle>Optimization Available</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              You can save ~{totalSavings}MB RAM by adding these to your{' '}
              <code className="bg-muted px-1 rounded">.env</code> file:
            </p>
            <pre className="bg-muted p-3 rounded text-sm mb-2 font-mono">
              {recommendations.map((r) => r.flag).join('\n')}
            </pre>
            <div className="text-sm text-muted-foreground space-y-1 mb-2">
              {recommendations.map((r) => (
                <p key={r.flag}>
                  • <code className="bg-muted px-1 rounded">{r.flag}</code>: {r.reason}
                </p>
              ))}
            </div>
            <p className="text-sm">
              Then restart:{' '}
              <code className="bg-muted px-1 rounded">./stop.sh</code>, edit{' '}
              <code className="bg-muted px-1 rounded">.env</code>, then{' '}
              <code className="bg-muted px-1 rounded">./start.sh</code>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>

        <Button onClick={handleComplete} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Completing...
            </>
          ) : (
            'Complete Setup'
          )}
        </Button>
      </div>
    </div>
  );
}
