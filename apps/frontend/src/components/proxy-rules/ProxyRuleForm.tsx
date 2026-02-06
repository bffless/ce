import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ProxyRule, CreateProxyRuleDto } from '@/services/proxyRulesApi';

interface ProxyRuleFormProps {
  initialData?: ProxyRule;
  onSubmit: (data: CreateProxyRuleDto) => Promise<void>;
  onCancel: () => void;
}

export function ProxyRuleForm({ initialData, onSubmit, onCancel }: ProxyRuleFormProps) {
  const [pathPattern, setPathPattern] = useState(initialData?.pathPattern || '');
  const [targetUrl, setTargetUrl] = useState(initialData?.targetUrl || '');
  const [stripPrefix, setStripPrefix] = useState(initialData?.stripPrefix ?? true);
  const [order, setOrder] = useState<number | undefined>(initialData?.order);
  const [timeout, setTimeout] = useState(initialData?.timeout || 30000);
  const [preserveHost, setPreserveHost] = useState(initialData?.preserveHost ?? false);
  const [forwardCookies, setForwardCookies] = useState(initialData?.forwardCookies ?? false);
  const [description, setDescription] = useState(initialData?.description || '');
  const [apiKey, setApiKey] = useState('');
  // Auth transformation (cookie to bearer)
  const [authTransformEnabled, setAuthTransformEnabled] = useState(
    !!initialData?.authTransform?.type,
  );
  const [cookieName, setCookieName] = useState(
    initialData?.authTransform?.cookieName || 'sAccessToken',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate path pattern
    if (!pathPattern) {
      newErrors.pathPattern = 'Path pattern is required';
    } else if (!/^(\/[a-zA-Z0-9\-_\/\*\.]*|\*[a-zA-Z0-9\-_\/\.]*)$/.test(pathPattern)) {
      newErrors.pathPattern = 'Path pattern must start with / or * and contain valid URL characters';
    }

    // Validate target URL
    if (!targetUrl) {
      newErrors.targetUrl = 'Target URL is required';
    } else {
      try {
        const url = new URL(targetUrl);
        // Allow HTTPS for any URL, or HTTP for internal/trusted services
        const isHttps = url.protocol === 'https:';
        const isInternalK8s = url.protocol === 'http:' &&
          (url.hostname.endsWith('.svc') || url.hostname.endsWith('.svc.cluster.local'));
        const isLocalhost = url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
        if (!isHttps && !isInternalK8s && !isLocalhost) {
          newErrors.targetUrl = 'Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost)';
        }
      } catch {
        newErrors.targetUrl = 'Invalid URL format';
      }
    }

    // Validate timeout
    if (timeout < 1000 || timeout > 60000) {
      newErrors.timeout = 'Timeout must be between 1000ms and 60000ms';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        pathPattern,
        targetUrl,
        stripPrefix,
        order,
        timeout,
        preserveHost,
        forwardCookies,
        description: description || undefined,
        headerConfig: apiKey ? { add: { Authorization: apiKey } } : undefined,
        authTransform: authTransformEnabled
          ? { type: 'cookie-to-bearer', cookieName }
          : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pathPattern">Path Pattern *</Label>
        <Input
          id="pathPattern"
          value={pathPattern}
          onChange={(e) => setPathPattern(e.target.value)}
          placeholder="/api/*"
          className={errors.pathPattern ? 'border-destructive' : ''}
        />
        {errors.pathPattern ? (
          <p className="text-xs text-destructive">{errors.pathPattern}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Examples: /api/*, /graphql, *.json
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="targetUrl">Target URL *</Label>
        <Input
          id="targetUrl"
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://api.example.com"
          className={errors.targetUrl ? 'border-destructive' : ''}
        />
        {errors.targetUrl ? (
          <p className="text-xs text-destructive">{errors.targetUrl}</p>
        ) : (
          <p className="text-xs text-muted-foreground">HTTPS required, or HTTP for internal services (*.svc, localhost)</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="order">Priority (Order)</Label>
        <Input
          id="order"
          type="number"
          min={0}
          value={order ?? ''}
          onChange={(e) => setOrder(e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder="Auto-assigned"
          className="max-w-32"
        />
        <p className="text-xs text-muted-foreground">
          Lower numbers are matched first. Leave empty to auto-assign.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="stripPrefix"
          checked={stripPrefix}
          onCheckedChange={setStripPrefix}
        />
        <Label htmlFor="stripPrefix" className="cursor-pointer">
          Strip matched path prefix
        </Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2 ml-7">
        When enabled, /api/users with pattern /api/* forwards to target/users
      </p>

      <div className="flex items-center gap-2">
        <Switch
          id="preserveHost"
          checked={preserveHost}
          onCheckedChange={setPreserveHost}
        />
        <Label htmlFor="preserveHost" className="cursor-pointer">
          Preserve original Host header
        </Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2 ml-7">
        Forward the original Host header instead of using the target host
      </p>

      <div className="flex items-center gap-2">
        <Switch
          id="forwardCookies"
          checked={forwardCookies}
          onCheckedChange={setForwardCookies}
        />
        <Label htmlFor="forwardCookies" className="cursor-pointer">
          Forward cookies to target
        </Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2 ml-7">
        Enable for session-based authentication with trusted backends
      </p>

      <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
        <div className="flex items-center gap-2">
          <Switch
            id="authTransform"
            checked={authTransformEnabled}
            onCheckedChange={setAuthTransformEnabled}
          />
          <Label htmlFor="authTransform" className="cursor-pointer font-medium">
            Cookie to Bearer Token
          </Label>
        </div>
        <p className="text-xs text-muted-foreground ml-7">
          Extract a cookie value and send it as Authorization: Bearer header.
          Useful for proxying to APIs that validate JWTs.
        </p>
        {authTransformEnabled && (
          <div className="space-y-2 ml-7">
            <Label htmlFor="cookieName">Cookie Name</Label>
            <Input
              id="cookieName"
              value={cookieName}
              onChange={(e) => setCookieName(e.target.value)}
              placeholder="sAccessToken"
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Default: sAccessToken (SuperTokens JWT cookie)
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeout">Timeout (ms)</Label>
        <Input
          id="timeout"
          type="number"
          min={1000}
          max={60000}
          value={timeout}
          onChange={(e) => setTimeout(Number(e.target.value))}
          className={errors.timeout ? 'border-destructive' : ''}
        />
        {errors.timeout ? (
          <p className="text-xs text-destructive">{errors.timeout}</p>
        ) : (
          <p className="text-xs text-muted-foreground">1000ms - 60000ms (default: 30000ms)</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key / Authorization Header (optional)</Label>
        <Input
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initialData ? '(unchanged - enter new value to update)' : 'Bearer sk_live_xxx'}
        />
        <p className="text-xs text-muted-foreground">
          Stored encrypted. Sent as Authorization header with each proxied request.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Main backend API"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : initialData ? 'Update Rule' : 'Create Rule'}
        </Button>
      </div>
    </form>
  );
}