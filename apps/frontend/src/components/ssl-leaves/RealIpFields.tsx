import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface RealIpFieldsValue {
  header: string;
  ranges: string;
}

export function RealIpFields({
  header,
  ranges,
  onChange,
}: RealIpFieldsValue & { onChange: (v: RealIpFieldsValue) => void }) {
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="text-sm font-medium cursor-pointer">Restore visitor IPs (optional)</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Skip this and everything works — logs and rate limiting will just see your CDN&apos;s IPs
          instead of visitors&apos;. To restore real IPs, paste your CDN&apos;s egress ranges.
        </p>
        <div>
          <Label htmlFor="realip-ranges">Trusted ranges (CIDR, one per line)</Label>
          <Textarea
            id="realip-ranges"
            value={ranges}
            onChange={(e) => onChange({ header, ranges: e.target.value })}
            placeholder={'151.101.0.0/16\n2a04:4e40::/32'}
            rows={4}
            className="mt-1 font-mono text-xs"
          />
        </div>
        <div>
          <Label htmlFor="realip-header">Header carrying the visitor IP</Label>
          <Input
            id="realip-header"
            value={header}
            onChange={(e) => onChange({ header: e.target.value, ranges })}
            placeholder="X-Forwarded-For"
            className="mt-1"
          />
        </div>
      </div>
    </details>
  );
}
