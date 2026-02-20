import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ProxyRule,
  CreateProxyRuleDto,
  ProxyType,
  EmailHandlerConfig,
} from '@/services/proxyRulesApi';
import { useGetEmailConfigStatusQuery } from '@/services/proxyRulesApi';
import { AlertTriangle } from 'lucide-react';

interface ProxyRuleFormProps {
  initialData?: ProxyRule;
  onSubmit: (data: CreateProxyRuleDto) => Promise<void>;
  onCancel: () => void;
}

/**
 * Get the effective proxy type from a rule, handling backward compatibility.
 */
function getEffectiveProxyType(rule?: ProxyRule): ProxyType {
  if (rule?.proxyType && rule.proxyType !== 'external_proxy') {
    return rule.proxyType;
  }
  // Backward compatibility: if internalRewrite is true, treat as internal_rewrite
  if (rule?.internalRewrite) {
    return 'internal_rewrite';
  }
  return rule?.proxyType || 'external_proxy';
}

export function ProxyRuleForm({ initialData, onSubmit, onCancel }: ProxyRuleFormProps) {
  // Get email config status
  const { data: emailStatus } = useGetEmailConfigStatusQuery();

  // Basic fields
  const [pathPattern, setPathPattern] = useState(initialData?.pathPattern || '');
  const [targetUrl, setTargetUrl] = useState(initialData?.targetUrl || '');
  const [proxyType, setProxyType] = useState<ProxyType>(getEffectiveProxyType(initialData));
  const [order, setOrder] = useState<number | undefined>(initialData?.order);
  const [description, setDescription] = useState(initialData?.description || '');

  // External proxy options
  const [stripPrefix, setStripPrefix] = useState(initialData?.stripPrefix ?? true);
  const [timeout, setTimeout] = useState(initialData?.timeout || 30000);
  const [preserveHost, setPreserveHost] = useState(initialData?.preserveHost ?? false);
  const [forwardCookies, setForwardCookies] = useState(initialData?.forwardCookies ?? false);
  const [apiKey, setApiKey] = useState('');

  // Auth transformation (cookie to bearer)
  const [authTransformEnabled, setAuthTransformEnabled] = useState(
    !!initialData?.authTransform?.type,
  );
  const [cookieName, setCookieName] = useState(
    initialData?.authTransform?.cookieName || 'sAccessToken',
  );

  // Email handler config
  const [destinationEmail, setDestinationEmail] = useState(
    initialData?.emailHandlerConfig?.destinationEmail || '',
  );
  const [emailSubject, setEmailSubject] = useState(
    initialData?.emailHandlerConfig?.subject || '',
  );
  const [successRedirect, setSuccessRedirect] = useState(
    initialData?.emailHandlerConfig?.successRedirect || '',
  );
  const [corsOrigin, setCorsOrigin] = useState(
    initialData?.emailHandlerConfig?.corsOrigin || '',
  );
  const [honeypotField, setHoneypotField] = useState(
    initialData?.emailHandlerConfig?.honeypotField || '',
  );
  const [replyToField, setReplyToField] = useState(
    initialData?.emailHandlerConfig?.replyToField || '',
  );
  const [requireAuth, setRequireAuth] = useState(
    initialData?.emailHandlerConfig?.requireAuth ?? false,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Derived state
  const isEmailHandler = proxyType === 'email_form_handler';
  const isInternalRewrite = proxyType === 'internal_rewrite';
  const isExternalProxy = proxyType === 'external_proxy';

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate path pattern
    if (!pathPattern) {
      newErrors.pathPattern = 'Path pattern is required';
    } else if (!/^(\/[a-zA-Z0-9\-_\/\*\.]*|\*[a-zA-Z0-9\-_\/\.]*)$/.test(pathPattern)) {
      newErrors.pathPattern =
        'Path pattern must start with / or * and contain valid URL characters';
    }

    // Validate based on proxy type
    if (isEmailHandler) {
      // Validate email handler fields
      if (!destinationEmail) {
        newErrors.destinationEmail = 'Destination email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinationEmail)) {
        newErrors.destinationEmail = 'Invalid email format';
      }

      // Validate success redirect URL if provided
      if (successRedirect) {
        try {
          new URL(successRedirect);
        } catch {
          newErrors.successRedirect = 'Invalid URL format';
        }
      }
    } else if (isInternalRewrite) {
      // Validate target path
      if (!targetUrl) {
        newErrors.targetUrl = 'Target path is required';
      } else if (!targetUrl.startsWith('/')) {
        newErrors.targetUrl =
          'Target path must start with "/" (e.g., /environments/production.json)';
      } else if (targetUrl.includes('://')) {
        newErrors.targetUrl =
          'Target path cannot contain a protocol (use a path like /path/to/file.json)';
      }
    } else {
      // External proxy - validate target URL
      if (!targetUrl) {
        newErrors.targetUrl = 'Target URL is required';
      } else {
        try {
          const url = new URL(targetUrl);
          const isHttps = url.protocol === 'https:';
          const isInternalK8s =
            url.protocol === 'http:' &&
            (url.hostname.endsWith('.svc') || url.hostname.endsWith('.svc.cluster.local'));
          const isLocalhost =
            url.protocol === 'http:' &&
            (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
          if (!isHttps && !isInternalK8s && !isLocalhost) {
            newErrors.targetUrl =
              'Target URL must use HTTPS, or HTTP for internal services (*.svc, localhost)';
          }
        } catch {
          newErrors.targetUrl = 'Invalid URL format';
        }
      }

      // Validate timeout
      if (timeout < 1000 || timeout > 60000) {
        newErrors.timeout = 'Timeout must be between 1000ms and 60000ms';
      }
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
      // Build email handler config if applicable
      let emailHandlerConfig: EmailHandlerConfig | undefined;
      if (isEmailHandler) {
        emailHandlerConfig = {
          destinationEmail,
          ...(emailSubject && { subject: emailSubject }),
          ...(successRedirect && { successRedirect }),
          ...(corsOrigin && { corsOrigin }),
          ...(honeypotField && { honeypotField }),
          ...(replyToField && { replyToField }),
          ...(requireAuth && { requireAuth }),
        };
      }

      await onSubmit({
        pathPattern,
        targetUrl: isEmailHandler ? '' : targetUrl, // Email handler doesn't use targetUrl
        proxyType,
        // Include internalRewrite for backward compatibility
        internalRewrite: isInternalRewrite,
        // Email handler config
        ...(isEmailHandler && { emailHandlerConfig }),
        // Only include external proxy options when using external proxy
        ...(isExternalProxy && {
          stripPrefix,
          timeout,
          preserveHost,
          forwardCookies,
          headerConfig: apiKey ? { add: { Authorization: apiKey } } : undefined,
          authTransform: authTransformEnabled
            ? { type: 'cookie-to-bearer' as const, cookieName }
            : undefined,
        }),
        order,
        description: description || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Path Pattern */}
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
          <p className="text-xs text-muted-foreground">Examples: /api/*, /graphql, *.json</p>
        )}
      </div>

      {/* Proxy Type Selector */}
      <div className="space-y-2">
        <Label htmlFor="proxyType">Rule Type</Label>
        <Select value={proxyType} onValueChange={(v) => setProxyType(v as ProxyType)}>
          <SelectTrigger id="proxyType">
            <SelectValue placeholder="Select rule type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="external_proxy">External Proxy</SelectItem>
            <SelectItem value="internal_rewrite">Internal Rewrite</SelectItem>
            <SelectItem value="email_form_handler">Email Form Handler</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {isExternalProxy && 'Forward requests to an external URL'}
          {isInternalRewrite && 'Serve a different path from the same deployment'}
          {isEmailHandler && 'Capture form submissions and email them'}
        </p>
      </div>

      {/* Email not configured warning */}
      {isEmailHandler && emailStatus && !emailStatus.isConfigured && (
        <div className="border border-yellow-500/50 bg-yellow-500/10 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Email not configured
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Email form handler requires email to be configured in Settings &gt; Email.
              Form submissions will fail until email is set up.
            </p>
          </div>
        </div>
      )}

      {/* Target URL/Path - not shown for email handler */}
      {!isEmailHandler && (
        <div className="space-y-2">
          <Label htmlFor="targetUrl">{isInternalRewrite ? 'Target Path *' : 'Target URL *'}</Label>
          <Input
            id="targetUrl"
            type={isInternalRewrite ? 'text' : 'url'}
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder={
              isInternalRewrite ? '/environments/production.json' : 'https://api.example.com'
            }
            className={errors.targetUrl ? 'border-destructive' : ''}
          />
          {errors.targetUrl ? (
            <p className="text-xs text-destructive">{errors.targetUrl}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isInternalRewrite
                ? 'Path within the deployment to serve (e.g., /environments/production.json)'
                : 'HTTPS required, or HTTP for internal services (*.svc, localhost)'}
            </p>
          )}
        </div>
      )}

      {/* Email Handler Configuration */}
      {isEmailHandler && (
        <div className="border rounded-lg p-4 space-y-4 bg-muted/50">
          <h4 className="font-medium text-sm">Email Handler Settings</h4>

          <div className="space-y-2">
            <Label htmlFor="destinationEmail">Destination Email *</Label>
            <Input
              id="destinationEmail"
              type="email"
              value={destinationEmail}
              onChange={(e) => setDestinationEmail(e.target.value)}
              placeholder="contact@example.com"
              className={errors.destinationEmail ? 'border-destructive' : ''}
            />
            {errors.destinationEmail ? (
              <p className="text-xs text-destructive">{errors.destinationEmail}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Form submissions will be sent to this email address
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emailSubject">Email Subject (optional)</Label>
            <Input
              id="emailSubject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Form Submission"
            />
            <p className="text-xs text-muted-foreground">
              Default: "Form Submission"
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="successRedirect">Success Redirect URL (optional)</Label>
            <Input
              id="successRedirect"
              type="url"
              value={successRedirect}
              onChange={(e) => setSuccessRedirect(e.target.value)}
              placeholder="https://example.com/thank-you"
              className={errors.successRedirect ? 'border-destructive' : ''}
            />
            {errors.successRedirect ? (
              <p className="text-xs text-destructive">{errors.successRedirect}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Redirect user here after successful submission (otherwise returns JSON)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="corsOrigin">CORS Origin (optional)</Label>
            <Input
              id="corsOrigin"
              value={corsOrigin}
              onChange={(e) => setCorsOrigin(e.target.value)}
              placeholder="https://example.com"
            />
            <p className="text-xs text-muted-foreground">
              Allow cross-origin form submissions from this origin
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="honeypotField">Honeypot Field Name (optional)</Label>
            <Input
              id="honeypotField"
              value={honeypotField}
              onChange={(e) => setHoneypotField(e.target.value)}
              placeholder="website"
            />
            <p className="text-xs text-muted-foreground">
              Spam protection: if this field is filled, submission is silently ignored
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="replyToField">Reply-To Field Name (optional)</Label>
            <Input
              id="replyToField"
              value={replyToField}
              onChange={(e) => setReplyToField(e.target.value)}
              placeholder="email"
            />
            <p className="text-xs text-muted-foreground">
              Use this form field value as the reply-to address in the email
            </p>
          </div>

          <div className="border-t pt-4 mt-4">
            <div className="flex items-center gap-2">
              <Switch
                id="requireAuth"
                checked={requireAuth}
                onCheckedChange={setRequireAuth}
              />
              <Label htmlFor="requireAuth" className="cursor-pointer font-medium">
                Require Authentication
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mt-2 ml-7">
              When enabled, only logged-in users can submit the form. User details (email, name)
              will be included in the notification email.
            </p>
          </div>
        </div>
      )}

      {/* Priority/Order */}
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

      {/* External proxy options - only shown for external proxy type */}
      {isExternalProxy && (
        <>
          <div className="flex items-center gap-2">
            <Switch id="stripPrefix" checked={stripPrefix} onCheckedChange={setStripPrefix} />
            <Label htmlFor="stripPrefix" className="cursor-pointer">
              Strip matched path prefix
            </Label>
          </div>
          <p className="text-xs text-muted-foreground -mt-2 ml-7">
            When enabled, /api/users with pattern /api/* forwards to target/users
          </p>

          <div className="flex items-center gap-2">
            <Switch id="preserveHost" checked={preserveHost} onCheckedChange={setPreserveHost} />
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
              Extract a cookie value and send it as Authorization: Bearer header. Useful for
              proxying to APIs that validate JWTs.
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
              placeholder={
                initialData ? '(unchanged - enter new value to update)' : 'Bearer sk_live_xxx'
              }
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted. Sent as Authorization header with each proxied request.
            </p>
          </div>
        </>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isEmailHandler ? 'Contact form handler' :
            isInternalRewrite ? 'Environment config rewrite' :
            'Main backend API'
          }
        />
      </div>

      {/* Submit buttons */}
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