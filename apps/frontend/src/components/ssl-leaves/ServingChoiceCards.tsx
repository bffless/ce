export type ServingMode = 'cloudflare' | 'proxy' | 'none';

const CHOICES: { mode: ServingMode; title: string; body: string }[] = [
  {
    mode: 'cloudflare',
    title: 'Through Cloudflare (recommended)',
    body: 'Cloudflare proxies your traffic and terminates TLS at its edge. You paste a free Origin Certificate; port 80 stays closed.',
  },
  {
    mode: 'proxy',
    title: 'Through another CDN or WAF',
    body: "Fastly, Bunny, a corporate WAF — anything that terminates TLS in front of this server. Most don't validate the origin, so this server can keep its built-in certificate with nothing to maintain.",
  },
  {
    mode: 'none',
    title: 'Directly',
    body: 'Your domain points straight at this server with an A record. The server holds a browser-trusted certificate itself.',
  },
];

export function ServingChoiceCards({
  value,
  onChange,
}: {
  value: ServingMode | null;
  onChange: (m: ServingMode) => void;
}) {
  return (
    <div className="space-y-3">
      {CHOICES.map((c) => (
        <label
          key={c.mode}
          className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
            value === c.mode ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
          }`}
        >
          <input
            type="radio"
            name="servingMode"
            checked={value === c.mode}
            onChange={() => onChange(c.mode)}
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
  );
}
