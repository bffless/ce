import { useEffect, useState } from 'react';
import { CurrentSslStatus } from './CurrentSslStatus';
import { ServingModelEditor, type EditorState } from './ServingModelEditor';
import { ApplyPanel } from './ApplyPanel';
import { RollbackPanel } from './RollbackPanel';
import { Button } from '@/components/ui/button';
import {
  useGetPrimarySslStatusQuery,
  useDiscardStagedCertificateMutation,
  type PrimarySslApplyBody,
  type PrimarySslStatus,
} from '@/services/primarySslApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';
import { useToast } from '@/hooks/use-toast';
import { errorMessage } from './toastError';

const DEFAULT_EDITOR_STATE: EditorState = {
  servingMode: 'none',
  sslMode: 'letsencrypt',
  port80: 'redirect',
  realIp: null,
  certificatePem: '',
  privateKeyPem: '',
};

/**
 * Splits the ranges textarea into individual CIDR strings. Mirrors
 * validateRealIp.ts's splitting (comma/newline/whitespace-delimited,
 * trimmed, empties dropped) so the config built here matches what the
 * ranges field would validate against server-side.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for unit testing (see PrimarySslManager.test.tsx)
export function splitRanges(rangesText: string): string[] {
  return rangesText
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

function usesRealIp(servingMode: EditorState['servingMode']): boolean {
  return servingMode !== 'cloudflare';
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for unit testing (see PrimarySslManager.test.tsx)
export function toApplyBody(editor: EditorState): PrimarySslApplyBody {
  const body: PrimarySslApplyBody = {
    proxyMode: editor.servingMode,
    sslMode: editor.sslMode,
    port80: editor.port80,
  };

  if (usesRealIp(editor.servingMode) && editor.realIp?.header) {
    const ranges = splitRanges(editor.realIp.ranges);
    if (ranges.length > 0) {
      body.realIp = { header: editor.realIp.header, ranges };
    }
  }

  return body;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for unit testing (see PrimarySslManager.test.tsx)
export function canApply(editor: EditorState, status: PrimarySslStatus | undefined): boolean {
  if (editor.sslMode === 'selfsigned') return true; // needs no cert
  if (status?.stagedCert) return true; // a staged cert is ready to promote
  // Knob-only edits (port 80 / real-IP) on the mode that's already serving a
  // cert stay enabled; switching modes requires staging first. The backend
  // remains authoritative — this only prevents the guaranteed-422 click.
  return editor.sslMode === status?.sslMode && status?.cert != null;
}

export function PrimarySslManager() {
  const { data } = useGetPrimarySslStatusQuery();
  const { isEnabled } = useFeatureFlags();
  const { toast } = useToast();
  const [editorState, setEditorState] = useState<EditorState>(DEFAULT_EDITOR_STATE);
  const [discardStaged, { isLoading: isDiscarding }] = useDiscardStagedCertificateMutation();

  const handleDiscard = async () => {
    try {
      await discardStaged().unwrap();
      toast({
        title: 'Staged certificate discarded',
        description: 'The staged certificate was removed. Nothing live changed.',
      });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: errorMessage(error, 'Failed to discard the staged certificate'),
        variant: 'destructive',
      });
    }
  };

  const realIpHeader = data?.realIp && 'header' in data.realIp ? data.realIp.header : null;
  const realIpRanges = data?.realIp && 'header' in data.realIp ? data.realIp.ranges.join('\n') : null;

  useEffect(() => {
    if (!data) return;
    setEditorState({
      servingMode: data.proxyMode ?? 'none',
      sslMode: data.sslMode ?? 'letsencrypt',
      port80: data.port80 ?? 'redirect',
      realIp: realIpHeader !== null ? { header: realIpHeader, ranges: realIpRanges ?? '' } : null,
      certificatePem: '',
      privateKeyPem: '',
    });
    // `data` deliberately omitted: RTK Query gives it a stable reference in
    // practice, but relying on that isn't guaranteed (and isn't true of a
    // naive test mock returning a fresh object per render). Depending only
    // on the primitive fields we actually read avoids an effect/render loop
    // when the container is re-rendered without any real status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.domain, data?.proxyMode, data?.sslMode, data?.port80, realIpHeader, realIpRanges]);

  if (!isEnabled('ENABLE_PRIMARY_SSL_MANAGEMENT')) return null;

  const config = toApplyBody(editorState);
  const applyEnabled = canApply(editorState, data);

  return (
    <div className="space-y-6">
      <CurrentSslStatus />
      <ServingModelEditor
        value={editorState}
        onChange={setEditorState}
        isCurrentlyLetsEncrypt={data?.sslMode === 'letsencrypt'}
        currentCertDaysLeft={data?.cert?.daysUntilExpiry ?? null}
      />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ApplyPanel config={config} disabled={!applyEnabled} />
          {data?.stagedCert && (
            <Button variant="outline" onClick={() => void handleDiscard()} disabled={isDiscarding}>
              {isDiscarding ? 'Discarding…' : 'Discard staged certificate'}
            </Button>
          )}
        </div>
        {!applyEnabled && (
          <p className="text-sm text-muted-foreground">
            Validate &amp; stage a certificate to enable Apply.
          </p>
        )}
      </div>
      <RollbackPanel pendingRevert={data?.pendingRevert ?? null} />
    </div>
  );
}
