import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type {
  ProxyRule,
  CreateProxyRuleDto,
  ProxyType,
  HttpMethod,
  EmailHandlerConfig,
} from '@/services/proxyRulesApi';
import { useGetEmailConfigStatusQuery, useTestProxyRuleMutation } from '@/services/proxyRulesApi';
import type { TestPipelineResult, ValidatorConfig } from '@/services/pipelinesApi';
import {
  AlertTriangle,
  Play,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Download,
  Upload,
} from 'lucide-react';
import { useRef } from 'react';
import {
  PipelineConfig,
  type PipelineConfigData,
  TestResultsVisualization,
} from '@/components/pipelines';

interface ExpandedProxyRuleFormProps {
  initialData?: ProxyRule;
  onSubmit: (data: CreateProxyRuleDto) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  projectId?: string;
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

/**
 * ExpandedProxyRuleForm - Full-page form for creating/editing proxy rules.
 * Refactored from ProxyRuleForm with expanded layout and section headers.
 */
export function ExpandedProxyRuleForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting: externalIsSubmitting,
  projectId = '',
}: ExpandedProxyRuleFormProps) {
  // Get email config status
  const { data: emailStatus } = useGetEmailConfigStatusQuery();

  // Basic fields
  const [pathPattern, setPathPattern] = useState(initialData?.pathPattern || '');
  const [method, setMethod] = useState<HttpMethod | null>(initialData?.method || null);
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
  const [emailSubject, setEmailSubject] = useState(initialData?.emailHandlerConfig?.subject || '');
  const [successRedirect, setSuccessRedirect] = useState(
    initialData?.emailHandlerConfig?.successRedirect || '',
  );
  const [corsOrigin, setCorsOrigin] = useState(initialData?.emailHandlerConfig?.corsOrigin || '');
  const [honeypotField, setHoneypotField] = useState(
    initialData?.emailHandlerConfig?.honeypotField || '',
  );
  const [replyToField, setReplyToField] = useState(
    initialData?.emailHandlerConfig?.replyToField || '',
  );
  const [requireAuth, setRequireAuth] = useState(
    initialData?.emailHandlerConfig?.requireAuth ?? false,
  );

  // Pipeline config (validators stored separately)
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfigData>(() => {
    if (initialData?.pipelineConfig) {
      // Strip validators since they're stored separately
      const { validators: _v, ...pipelineWithoutValidators } = initialData.pipelineConfig;
      return pipelineWithoutValidators as PipelineConfigData;
    }
    return { name: '', steps: [] };
  });
  const [validators, setValidators] = useState<ValidatorConfig[]>(() => {
    return initialData?.pipelineConfig?.validators || [];
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Simple dirty detection using timestamps
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialData ? Date.now() : null);
  const [lastModifiedAt, setLastModifiedAt] = useState<number | null>(null);

  // Pipeline export/import handlers
  const handleExportPipeline = () => {
    const exportData = {
      name: pipelineConfig.name,
      description: pipelineConfig.description,
      steps: pipelineConfig.steps,
      validators: validators,
      // Include rule metadata for context
      _meta: {
        pathPattern,
        method: method || 'ANY',
        exportedAt: new Date().toISOString(),
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-${pipelineConfig.name || 'config'}.json`.replace(/[^a-z0-9-_.]/gi, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportPipeline = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        // Update pipeline config
        setPipelineConfig({
          name: data.name || '',
          description: data.description || '',
          steps: data.steps || [],
        });
        // Update validators
        if (data.validators) {
          setValidators(data.validators);
        }
      } catch (err) {
        console.error('Failed to parse pipeline JSON:', err);
        alert('Invalid pipeline JSON file');
      }
    };
    reader.readAsText(file);
    // Reset file input so the same file can be imported again
    event.target.value = '';
  };

  // Derived state
  const isEmailHandler = proxyType === 'email_form_handler';
  const isInternalRewrite = proxyType === 'internal_rewrite';
  const isExternalProxy = proxyType === 'external_proxy';
  const isPipeline = proxyType === 'pipeline';
  const submitting = externalIsSubmitting || isSubmitting;

  // Simple dirty detection: form is dirty if modified after last save
  const isDirty = lastModifiedAt !== null && (lastSavedAt === null || lastModifiedAt > lastSavedAt);

  // Track if this is the first render to skip initial effect
  const isFirstRender = useRef(true);

  // Mark form as modified whenever any field changes (skip initial render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setLastModifiedAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pathPattern,
    method,
    targetUrl,
    proxyType,
    order,
    description,
    stripPrefix,
    timeout,
    preserveHost,
    forwardCookies,
    apiKey,
    authTransformEnabled,
    cookieName,
    destinationEmail,
    emailSubject,
    successRedirect,
    corsOrigin,
    honeypotField,
    replyToField,
    requireAuth,
    pipelineConfig,
    validators,
  ]);

  // Warn user before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const validate = (): Record<string, string> => {
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
    } else if (isExternalProxy) {
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
    } else if (isPipeline) {
      // Validate pipeline config
      if (!pipelineConfig.name) {
        newErrors.pipelineName = 'Pipeline name is required';
      }
      if (!pipelineConfig.steps || pipelineConfig.steps.length === 0) {
        newErrors.pipelineSteps = 'At least one step is required';
      }
    }

    setErrors(newErrors);
    return newErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      // Scroll to first error field
      const firstErrorKey = Object.keys(validationErrors)[0];
      if (firstErrorKey) {
        // Map error keys to input IDs
        const idMap: Record<string, string> = {
          pipelineName: 'pipeline-name',
          pipelineSteps: 'pipeline-name', // Scroll to pipeline section
        };
        const targetId = idMap[firstErrorKey] || firstErrorKey;
        const errorElement = document.getElementById(targetId);
        if (errorElement) {
          errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          errorElement.focus();
        } else {
          // Scroll to top if we can't find the specific field
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
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
        method: method || undefined, // null/undefined = match any method
        targetUrl: isEmailHandler || isPipeline ? '' : targetUrl, // Email handler and pipeline don't use targetUrl
        proxyType,
        // Include internalRewrite for backward compatibility
        internalRewrite: isInternalRewrite,
        // Email handler config
        ...(isEmailHandler && { emailHandlerConfig }),
        // Pipeline config (include validators)
        ...(isPipeline && { pipelineConfig: { ...pipelineConfig, validators } }),
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

      // After successful save, reset dirty state
      setLastSavedAt(Date.now());
      setLastModifiedAt(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Configuration</CardTitle>
          <CardDescription>Define the path pattern and rule type</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Path Pattern and Method */}
          <div className="grid grid-cols-[1fr,auto] gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <Select
                value={method || 'ANY'}
                onValueChange={(v) => setMethod(v === 'ANY' ? null : (v as HttpMethod))}
              >
                <SelectTrigger id="method" className="w-28">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">HTTP method filter</p>
            </div>
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
                <SelectItem value="pipeline">Pipeline</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isExternalProxy && 'Forward requests to an external URL'}
              {isInternalRewrite && 'Serve a different path from the same deployment'}
              {isEmailHandler && 'Capture form submissions and email them'}
              {isPipeline && 'Build a custom workflow with multiple steps'}
            </p>
          </div>

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

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isEmailHandler
                  ? 'Contact form handler'
                  : isInternalRewrite
                    ? 'Environment config rewrite'
                    : 'Main backend API'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Email not configured warning */}
      {isEmailHandler && emailStatus && !emailStatus.isConfigured && (
        <div className="border border-yellow-500/50 bg-yellow-500/10 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Email not configured
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Email form handler requires email to be configured in Settings &gt; Email. Form
              submissions will fail until email is set up.
            </p>
          </div>
        </div>
      )}

      {/* Target Configuration (External Proxy & Internal Rewrite only) */}
      {!isEmailHandler && !isPipeline && (
        <Card>
          <CardHeader>
            <CardTitle>Target Configuration</CardTitle>
            <CardDescription>
              {isInternalRewrite
                ? 'Specify the internal path to serve'
                : 'Specify the external URL to proxy requests to'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="targetUrl">
                {isInternalRewrite ? 'Target Path *' : 'Target URL *'}
              </Label>
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
          </CardContent>
        </Card>
      )}

      {/* Email Handler Configuration */}
      {isEmailHandler && (
        <Card>
          <CardHeader>
            <CardTitle>Email Handler Settings</CardTitle>
            <CardDescription>Configure where form submissions are sent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <p className="text-xs text-muted-foreground">Default: "Form Submission"</p>
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
                <Switch id="requireAuth" checked={requireAuth} onCheckedChange={setRequireAuth} />
                <Label htmlFor="requireAuth" className="cursor-pointer font-medium">
                  Require Authentication
                </Label>
              </div>
              <p className="text-xs text-muted-foreground mt-2 ml-7">
                When enabled, only logged-in users can submit the form. User details (email, name)
                will be included in the notification email.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Configuration */}
      {isPipeline && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Pipeline Configuration</CardTitle>
              <CardDescription>Define the steps that process incoming requests</CardDescription>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportPipeline}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                Import
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleExportPipeline}>
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {errors.pipelineName && (
              <p className="text-xs text-destructive mb-2">{errors.pipelineName}</p>
            )}
            {errors.pipelineSteps && (
              <p className="text-xs text-destructive mb-2">{errors.pipelineSteps}</p>
            )}
            <PipelineConfig
              config={pipelineConfig}
              onChange={setPipelineConfig}
              projectId={projectId}
              validators={validators}
              onValidatorsChange={setValidators}
            />
          </CardContent>
        </Card>
      )}

      {/* Pipeline Test Panel - Only shown when rule is saved */}
      {isPipeline && initialData?.id && (
        <PipelineTestCard ruleId={initialData.id} pathPattern={pathPattern} method={method} />
      )}

      {/* External Proxy Options */}
      {isExternalProxy && (
        <Card>
          <CardHeader>
            <CardTitle>Proxy Options</CardTitle>
            <CardDescription>Configure how requests are forwarded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div className="space-y-2">
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                min={1000}
                max={60000}
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
                className={errors.timeout ? 'border-destructive max-w-32' : 'max-w-32'}
              />
              {errors.timeout ? (
                <p className="text-xs text-destructive">{errors.timeout}</p>
              ) : (
                <p className="text-xs text-muted-foreground">1000ms - 60000ms (default: 30000ms)</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Authentication Options (External Proxy Only) */}
      {isExternalProxy && (
        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>Configure authentication for proxied requests</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      )}

      {/* Submit buttons */}
      <div className="flex items-center justify-end gap-2 pt-4">
        {isDirty && (
          <Badge
            variant="outline"
            className="text-yellow-600 border-yellow-500/50 bg-yellow-500/10"
          >
            Unsaved changes
          </Badge>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : initialData ? 'Update Rule' : 'Create Rule'}
        </Button>
      </div>
    </form>
  );
}

// ==================== Pipeline Test Card ====================

interface HeaderEntry {
  key: string;
  value: string;
}

interface QueryParamEntry {
  key: string;
  value: string;
}

interface PipelineTestCardProps {
  ruleId: string;
  pathPattern: string;
  method: HttpMethod | null;
}

function PipelineTestCard({ ruleId, pathPattern, method }: PipelineTestCardProps) {
  const [testProxyRule, { isLoading }] = useTestProxyRuleMutation();

  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<HttpMethod>('POST');
  const [bodyJson, setBodyJson] = useState(
    '{\n  "email": "test@example.com",\n  "name": "Test User"\n}',
  );
  const [queryParams, setQueryParams] = useState<QueryParamEntry[]>([]);
  const [headers, setHeaders] = useState<HeaderEntry[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [simulateAuth, setSimulateAuth] = useState(true);
  const [mockUserId, setMockUserId] = useState('');
  const [mockUserEmail, setMockUserEmail] = useState('');
  const [mockUserRole, setMockUserRole] = useState('');
  const [deploymentAlias, setDeploymentAlias] = useState('production');
  const [result, setResult] = useState<TestPipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Determine if this method typically has a body
  // If method prop is null (any), use selectedMethod; otherwise use the fixed method
  const effectiveMethod = method || selectedMethod;
  const methodHasBody = ['POST', 'PUT', 'PATCH'].includes(effectiveMethod);

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    setHeaders(headers.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  };

  const addQueryParam = () => {
    setQueryParams([...queryParams, { key: '', value: '' }]);
  };

  const removeQueryParam = (index: number) => {
    setQueryParams(queryParams.filter((_, i) => i !== index));
  };

  const updateQueryParam = (index: number, field: 'key' | 'value', value: string) => {
    setQueryParams(queryParams.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const runTest = async () => {
    setError(null);
    setResult(null);

    // Parse body JSON only if method has body
    let body: Record<string, unknown> | undefined;
    if (methodHasBody && bodyJson.trim()) {
      try {
        body = JSON.parse(bodyJson);
      } catch {
        setError('Invalid JSON in request body');
        return;
      }
    }

    // Build query params object
    const query: Record<string, unknown> = {};
    for (const p of queryParams) {
      if (p.key) {
        query[p.key] = p.value;
      }
    }

    // Build headers object
    const headersObj: Record<string, string> = {};
    for (const h of headers) {
      if (h.key) {
        headersObj[h.key] = h.value;
      }
    }

    // Build mock user if provided
    const mockUser = mockUserId
      ? {
          id: mockUserId,
          email: mockUserEmail || undefined,
          role: mockUserRole || undefined,
        }
      : undefined;

    try {
      const testResult = await testProxyRule({
        id: ruleId,
        data: {
          method: effectiveMethod,
          path: pathPattern,
          body,
          query: Object.keys(query).length > 0 ? query : undefined,
          headers: headersObj,
          simulateAuth,
          mockUser,
          deploymentAlias: deploymentAlias || undefined,
        },
      }).unwrap();

      setResult(testResult);
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message || 'Test execution failed';
      setError(errorMessage);
    }
  };

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Play className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-base">Test Pipeline</CardTitle>
              <Badge variant="outline" className="text-xs">
                Debug Mode
              </Badge>
            </div>
            <CardDescription>
              Run the pipeline with test data and view step-by-step execution results
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Method selector / indicator */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Testing as:</span>
              {method ? (
                <Badge variant="outline">{method}</Badge>
              ) : (
                <Select
                  value={selectedMethod}
                  onValueChange={(v) => setSelectedMethod(v as HttpMethod)}
                >
                  <SelectTrigger className="w-28 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="PATCH">PATCH</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {!method && (
                <span className="text-xs text-muted-foreground">(rule matches any method)</span>
              )}
            </div>

            {/* Query Parameters */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Query Parameters</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addQueryParam}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Param
                </Button>
              </div>
              {queryParams.length === 0 ? (
                <p className="text-xs text-muted-foreground">No query parameters</p>
              ) : (
                <div className="space-y-2">
                  {queryParams.map((param, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Parameter name"
                        value={param.key}
                        onChange={(e) => updateQueryParam(index, 'key', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Value"
                        value={param.value}
                        onChange={(e) => updateQueryParam(index, 'value', e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQueryParam(index)}
                        className="shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Request Body - only show for methods that have body */}
            {methodHasBody && (
              <div className="space-y-2">
                <Label>Request Body (JSON)</Label>
                <Textarea
                  value={bodyJson}
                  onChange={(e) => setBodyJson(e.target.value)}
                  className="font-mono text-sm min-h-[120px]"
                  placeholder='{"key": "value"}'
                />
              </div>
            )}

            {/* Headers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Headers</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addHeader}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Header
                </Button>
              </div>
              <div className="space-y-2">
                {headers.map((header, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Header name"
                      value={header.key}
                      onChange={(e) => updateHeader(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={header.value}
                      onChange={(e) => updateHeader(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeHeader(index)}
                      className="shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Authentication */}
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <Switch
                  id="simulateAuth"
                  checked={simulateAuth}
                  onCheckedChange={setSimulateAuth}
                />
                <Label htmlFor="simulateAuth" className="cursor-pointer">
                  Simulate authenticated user
                </Label>
              </div>
              {simulateAuth && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mock User ID</Label>
                    <Input
                      placeholder="Leave empty to use your ID"
                      value={mockUserId}
                      onChange={(e) => setMockUserId(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mock Email</Label>
                    <Input
                      placeholder="test@example.com"
                      value={mockUserEmail}
                      onChange={(e) => setMockUserEmail(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mock Role</Label>
                    <Input
                      placeholder="admin"
                      value={mockUserRole}
                      onChange={(e) => setMockUserRole(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Deployment / Skills Context */}
            <div className="space-y-2">
              <Label htmlFor="deploymentAlias">Deployment Alias (for Skills)</Label>
              <Input
                id="deploymentAlias"
                placeholder="production"
                value={deploymentAlias}
                onChange={(e) => setDeploymentAlias(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Used to load skills from a specific deployment (e.g., production, staging)
              </p>
            </div>

            {/* Run Button */}
            <Button type="button" onClick={runTest} disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running Test...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Test
                </>
              )}
            </Button>

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span className="font-medium">Error</span>
                </div>
                <p className="text-sm mt-1">{error}</p>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-3">
                {/* Quick Summary */}
                <div
                  className={`p-3 rounded-lg border ${result.success ? 'bg-green-500/10 border-green-500/30' : 'bg-destructive/10 border-destructive/30'}`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    <span className="font-medium">
                      {result.success ? 'Test Passed' : 'Test Failed'}
                    </span>
                    <Badge variant="outline" className="ml-auto">
                      {result.durationMs}ms
                    </Badge>
                  </div>
                  {result.error && (
                    <p className="text-sm text-destructive mt-2">{result.error.message}</p>
                  )}
                </div>

                {/* Detailed Results */}
                {result.debug && <TestResultsVisualization result={result} />}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
