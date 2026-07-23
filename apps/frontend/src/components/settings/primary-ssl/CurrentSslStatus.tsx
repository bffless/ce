import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useGetPrimarySslStatusQuery } from '@/services/primarySslApi';
import { Shield } from 'lucide-react';
import type { PrimarySslStatus } from '@/services/primarySslApi';

const TRAFFIC_LABELS: Record<NonNullable<PrimarySslStatus['proxyMode']>, string> = {
  none: 'Directly',
  cloudflare: 'Through Cloudflare',
  proxy: 'Through a CDN or WAF',
};

const CERTIFICATE_LABELS: Record<NonNullable<PrimarySslStatus['sslMode']>, string> = {
  letsencrypt: "Let's Encrypt",
  paste: 'Pasted (bring-your-own)',
  selfsigned: 'Self-signed (built-in)',
};

export function CurrentSslStatus() {
  const { data, isLoading } = useGetPrimarySslStatusQuery();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current SSL Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Loading…</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.domain === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current SSL Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">
            No primary domain configured
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Current SSL Status
        </CardTitle>
        <CardDescription>
          {data.domain}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Traffic</label>
            <p className="text-sm text-foreground mt-1">
              {data.proxyMode ? TRAFFIC_LABELS[data.proxyMode] : '—'}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Certificate</label>
            <p className="text-sm text-foreground mt-1">
              {data.sslMode ? CERTIFICATE_LABELS[data.sslMode] : '—'}
            </p>
          </div>
        </div>

        {data.sslMode !== 'selfsigned' && data.cert && (
          <div>
            <label className="text-sm font-medium">Certificate Expiry</label>
            <p className="text-sm text-foreground mt-1">
              Expires in {data.cert.daysUntilExpiry} days
            </p>
          </div>
        )}

        {data.wildcardCovered && data.sslMode !== 'selfsigned' && (
          <div>
            <Badge>Wildcard Covered</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
