import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { setServingMode, setBootstrapSslMode, prevWizardStep, ServingMode } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';

const CHOICES: { mode: ServingMode; title: string; body: string }[] = [
  {
    mode: 'cloudflare',
    title: 'Through Cloudflare (recommended)',
    body: 'Cloudflare proxies your traffic and terminates TLS at its edge. You paste a free Origin Certificate; port 80 stays closed.',
  },
  {
    mode: 'proxy',
    title: 'Through another CDN or WAF',
    body: "Fastly, Bunny, a corporate WAF — anything that terminates TLS in front of this server. You paste that service's origin certificate.",
  },
  {
    mode: 'none',
    title: 'Directly',
    body: 'Your domain points straight at this server with an A record. The server holds a browser-trusted certificate itself.',
  },
];

export function ServingChoicePhase({ onNext }: { onNext: () => void }) {
  const dispatch = useDispatch();
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);
  const complete = servingMode !== null && (servingMode !== 'none' || bootstrapSslMode !== null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">How does traffic reach this server?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This choice drives the DNS setup, the certificate step, and how nginx is configured.
          You can go back and change it any time before the final Apply.
        </p>
      </div>

      <div className="space-y-3">
        {CHOICES.map((c) => (
          <label
            key={c.mode}
            className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
              servingMode === c.mode ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <input
              type="radio"
              name="servingMode"
              checked={servingMode === c.mode}
              onChange={() => dispatch(setServingMode(c.mode))}
              className="mt-1 mr-3"
              aria-label={c.title}
            />
            <div className="flex-1">
              <span className="font-medium">{c.title}</span>
              <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            </div>
          </label>
        ))}
      </div>

      {servingMode === 'none' && (
        <div className="ml-6 space-y-3">
          <p className="text-sm font-medium text-foreground">Where will the certificate come from?</p>
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

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => dispatch(prevWizardStep())}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!complete}>Next</Button>
      </div>
    </div>
  );
}
