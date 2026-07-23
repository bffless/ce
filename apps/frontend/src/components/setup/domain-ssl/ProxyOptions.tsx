import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { setBootstrapRealIp, setBootstrapPort80 } from '@/store/slices/setupSlice';
import { validateRealIp } from '@/lib/validateRealIp';
import { RealIpFields } from '@/components/ssl-leaves/RealIpFields';

// Proxy-only origin knobs, shared by all three proxy cert modes (self-signed,
// Let's Encrypt, paste). Dispatches to the store on change so the Apply step
// reads them back. The realIp fields are OPTIONAL — invalid input shows an
// inline error and simply isn't applied (dispatched as null), rather than
// hard-blocking; the backend combo-validation is the authoritative gate.
export function ProxyOptions() {
  const dispatch = useDispatch();
  const bootstrapSslMode = useSelector((s: RootState) => s.setup.wizard.bootstrapSslMode);
  const [rangesText, setRangesText] = useState('');
  const [header, setHeader] = useState('');
  const [closePort80, setClosePort80] = useState(false);
  const [rangesError, setRangesError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);

  // Let's Encrypt is HTTP-01 and needs port 80 open (validateApplyConfig
  // rejects port80:'closed' with sslMode:'letsencrypt'), and Apply has no
  // Back button — so a stale 'closed' picked under selfsigned/paste before
  // switching the sub-choice to letsencrypt would otherwise be a dead-end at
  // Apply. Clear it (store + local checkbox) whenever the mode becomes
  // letsencrypt; the checkbox itself is also hidden below in that mode.
  useEffect(() => {
    if (bootstrapSslMode === 'letsencrypt') {
      setClosePort80(false);
      dispatch(setBootstrapPort80(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapSslMode]);

  const applyRealIp = (nextRanges: string, nextHeader: string) => {
    setRangesError(null);
    setHeaderError(null);
    if (!nextRanges.trim()) {
      dispatch(setBootstrapRealIp(null));
      return;
    }
    const result = validateRealIp(nextRanges, nextHeader);
    if (result.rangesError || result.headerError) {
      setRangesError(result.rangesError);
      setHeaderError(result.headerError);
      dispatch(setBootstrapRealIp(null)); // don't apply invalid input
      return;
    }
    dispatch(setBootstrapRealIp({ header: result.header, ranges: result.ranges }));
  };

  return (
    <div className="space-y-4">
      <RealIpFields
        header={header}
        ranges={rangesText}
        onChange={({ header: nextHeader, ranges: nextRanges }) => {
          setRangesText(nextRanges);
          setHeader(nextHeader);
          applyRealIp(nextRanges, nextHeader);
        }}
        headerError={headerError}
        rangesError={rangesError}
      />
      {bootstrapSslMode !== 'letsencrypt' && (
        <label className="flex items-start text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={closePort80}
            onChange={(e) => { setClosePort80(e.target.checked); dispatch(setBootstrapPort80(e.target.checked ? 'closed' : null)); }}
            className="mt-0.5 mr-2"
          />
          <span>Close port 80 — my CDN connects to this origin over HTTPS only</span>
        </label>
      )}
    </div>
  );
}
