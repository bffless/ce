import { useEffect, useState } from 'react';
import { CurrentSslStatus } from './CurrentSslStatus';
import { ServingModelEditor, type EditorState } from './ServingModelEditor';
import { ApplyPanel } from './ApplyPanel';
import { RollbackPanel } from './RollbackPanel';
import { useGetPrimarySslStatusQuery, type PrimarySslApplyBody } from '@/services/primarySslApi';
import { useFeatureFlags } from '@/services/featureFlagsApi';

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
 * validateRealIp.ts's splitting (newline-delimited, trimmed, empties
 * dropped) so the config built here matches what the ranges field would
 * validate against server-side.
 */
function splitRanges(rangesText: string): string[] {
  return rangesText
    .split(/[\n,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

function usesRealIp(servingMode: EditorState['servingMode']): boolean {
  return servingMode !== 'cloudflare';
}

function toApplyBody(editor: EditorState): PrimarySslApplyBody {
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

export function PrimarySslManager() {
  const { data } = useGetPrimarySslStatusQuery();
  const { isEnabled } = useFeatureFlags();
  const [editorState, setEditorState] = useState<EditorState>(DEFAULT_EDITOR_STATE);

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

  return (
    <div className="space-y-6">
      <CurrentSslStatus />
      <ServingModelEditor
        value={editorState}
        onChange={setEditorState}
        onCertStaged={() => {
          /* no-op: ApplyPanel reads the latest editorState on Apply click */
        }}
      />
      <ApplyPanel config={config} disabled={false} />
      <RollbackPanel pendingRevert={data?.pendingRevert ?? null} />
    </div>
  );
}
