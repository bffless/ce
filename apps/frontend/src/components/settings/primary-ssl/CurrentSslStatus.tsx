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
            <label className="text-sm font-medium">Serving Mode</label>
            <p className="text-sm text-foreground mt-1 capitalize">
              {data.sslMode}
            </p>
          </div>

          {data.sslMode === 'selfsigned' ? (
            <div>
              <label className="text-sm font-medium">Certificate</label>
              <p className="text-sm text-foreground mt-1">
                Self-signed (built-in)
              </p>
            </div>
          ) : (
            data.cert && (
              <div>
                <label className="text-sm font-medium">Certificate Expiry</label>
                <p className="text-sm text-foreground mt-1">
                  {data.cert.daysUntilExpiry} days
                </p>
              </div>
            )
          )}
        </div>

        {data.wildcardCovered && (
          <div>
            <Badge>Wildcard Covered</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
