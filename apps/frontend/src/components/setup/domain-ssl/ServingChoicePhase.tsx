import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { setServingMode, setBootstrapSslMode, prevWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { ServingChoiceCards } from '@/components/ssl-leaves/ServingChoiceCards';

export function ServingChoicePhase({ onNext }: { onNext: () => void }) {
  const dispatch = useDispatch();
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);
  const complete = servingMode !== null && (servingMode !== 'none' || bootstrapSslMode !== null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">How does traffic reach this server?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This choice drives the DNS setup, the certificate step, and how nginx is configured. You
          can go back and change it any time before the final Apply.
        </p>
      </div>

      <ServingChoiceCards value={servingMode} onChange={(mode) => dispatch(setServingMode(mode))} />

      {servingMode === 'none' && (
        <div className="ml-6 space-y-3">
          <p className="text-sm font-medium text-foreground">
            Where will the certificate come from?
          </p>
          <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
            <input
              type="radio"
              name="bootstrapSslMode"
              checked={bootstrapSslMode === 'letsencrypt'}
              onChange={() => dispatch(setBootstrapSslMode('letsencrypt'))}
              className="mt-1 mr-3"
              aria-label="Auto-issue with Let's Encrypt (recommended)"
            />
            <div className="flex-1">
              <span className="font-medium">Auto-issue with Let&apos;s Encrypt (recommended)</span>
              <p className="mt-1 text-sm text-muted-foreground">
                Free, issued right here, renews automatically. Needs your DNS pointing at this
                server and port 80 reachable — the next step checks both for you.
              </p>
            </div>
          </label>
          <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
            <input
              type="radio"
              name="bootstrapSslMode"
              checked={bootstrapSslMode === 'paste'}
              onChange={() => dispatch(setBootstrapSslMode('paste'))}
              className="mt-1 mr-3"
              aria-label="Paste my own certificate"
            />
            <div className="flex-1">
              <span className="font-medium">Paste my own certificate</span>
              <p className="mt-1 text-sm text-muted-foreground">
                A browser-trusted certificate from any CA. You&apos;ll paste the full chain and
                private key, and re-paste when you renew it.
              </p>
            </div>
          </label>
        </div>
      )}

      {servingMode === 'proxy' && (
        <div className="ml-6 space-y-3">
          <p className="text-sm font-medium text-foreground">Certificate for the origin</p>
          {(
            [
              [
                'selfsigned',
                'Keep the built-in certificate (recommended)',
                "Zero maintenance. Works with CDNs that don't validate the origin certificate (the common default). The link from your CDN to this server is encrypted but unauthenticated — if you turn on your CDN's origin verification, pick one of the options below instead.",
              ],
              [
                'letsencrypt',
                "Auto-issue with Let's Encrypt",
                'A real auto-renewing certificate on this server. Needs your CDN to pass ACME challenges through to the origin (or the origin reachable on port 80).',
              ],
              [
                'paste',
                'Paste my own certificate',
                "Paste your CDN's origin certificate or any browser-trusted cert. You'll re-paste when it expires.",
              ],
            ] as const
          ).map(([mode, title, body]) => (
            <label
              key={mode}
              className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50"
            >
              <input
                type="radio"
                name="bootstrapSslMode"
                checked={bootstrapSslMode === mode}
                onChange={() => dispatch(setBootstrapSslMode(mode))}
                className="mt-1 mr-3"
                aria-label={title}
              />
              <div className="flex-1">
                <span className="font-medium">{title}</span>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!complete}>
          Next
        </Button>
      </div>
    </div>
  );
}
