import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Shield, Lock, Timer, Filter } from 'lucide-react';
import { ExpressionInput } from './handlers/ExpressionInput';
import type {
  ValidatorConfig,
  ValidatorType,
  ValidatorCondition,
  ValidatorConditionOperator,
  AuthRequiredConfig,
  RateLimitConfig,
} from '@/services/pipelinesApi';

interface ValidatorsConfigProps {
  validators: ValidatorConfig[];
  onChange: (validators: ValidatorConfig[]) => void;
}

// Available validator types with descriptions
const VALIDATOR_INFO: Record<ValidatorType, { label: string; description: string; icon: typeof Shield }> = {
  auth_required: {
    label: 'Authentication Required',
    description: 'Require user authentication before pipeline execution',
    icon: Lock,
  },
  rate_limit: {
    label: 'Rate Limit',
    description: 'Limit the number of requests within a time window',
    icon: Timer,
  },
};

// Default configurations for each validator type
const DEFAULT_AUTH_CONFIG: AuthRequiredConfig = {};
const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  limit: 100,
  windowSeconds: 60,
  keyBy: 'ip',
};

function createValidator(type: ValidatorType): ValidatorConfig {
  if (type === 'auth_required') {
    return { type: 'auth_required', config: { ...DEFAULT_AUTH_CONFIG } };
  }
  return { type: 'rate_limit', config: { ...DEFAULT_RATE_LIMIT_CONFIG } };
}

/**
 * ValidatorsConfig - Configure pipeline validators
 * Allows adding, removing, and configuring auth and rate limit validators
 */
export function ValidatorsConfig({ validators, onChange }: ValidatorsConfigProps) {
  const addValidator = useCallback(
    (type: ValidatorType) => {
      // Don't add duplicate validators
      if (validators.some((v) => v.type === type)) {
        return;
      }
      onChange([...validators, createValidator(type)]);
    },
    [validators, onChange]
  );

  const removeValidator = useCallback(
    (index: number) => {
      onChange(validators.filter((_, i) => i !== index));
    },
    [validators, onChange]
  );

  const updateAuthRequiredConfig = useCallback(
    (index: number, config: AuthRequiredConfig) => {
      onChange(
        validators.map((v, i) =>
          i === index && v.type === 'auth_required'
            ? { type: 'auth_required' as const, config }
            : v
        )
      );
    },
    [validators, onChange]
  );

  const updateRateLimitConfig = useCallback(
    (index: number, config: RateLimitConfig) => {
      onChange(
        validators.map((v, i) =>
          i === index && v.type === 'rate_limit'
            ? { type: 'rate_limit' as const, config }
            : v
        )
      );
    },
    [validators, onChange]
  );

  const updateCondition = useCallback(
    (index: number, condition: ValidatorCondition | undefined) => {
      onChange(
        validators.map((v, i) =>
          i === index ? { ...v, condition } : v
        )
      );
    },
    [validators, onChange]
  );

  // Get available validator types (not already added)
  const availableTypes = (Object.keys(VALIDATOR_INFO) as ValidatorType[]).filter(
    (type) => !validators.some((v) => v.type === type)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-500" />
          <Label className="text-base">Validators</Label>
        </div>
        {availableTypes.length > 0 && (
          <Select
            value=""
            onValueChange={(type) => addValidator(type as ValidatorType)}
          >
            <SelectTrigger className="w-[180px]">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <span>Add Validator</span>
              </div>
            </SelectTrigger>
            <SelectContent>
              {availableTypes.map((type) => {
                const info = VALIDATOR_INFO[type];
                const Icon = info.icon;
                return (
                  <SelectItem key={type} value={type}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {info.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      {validators.length === 0 ? (
        <Card className="bg-muted/30">
          <CardContent className="py-6 text-center text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No validators configured.</p>
            <p className="text-xs mt-1">
              Add validators to enforce authentication or rate limiting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {validators.map((validator, index) => {
            const info = VALIDATOR_INFO[validator.type];
            const Icon = info.icon;
            return (
              <Card key={validator.type}>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-blue-500" />
                      <CardTitle className="text-sm font-medium">{info.label}</CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {validator.type}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeValidator(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription className="text-xs">{info.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {validator.type === 'auth_required' && (
                    <AuthRequiredConfigForm
                      config={validator.config}
                      onChange={(config) => updateAuthRequiredConfig(index, config)}
                    />
                  )}
                  {validator.type === 'rate_limit' && (
                    <RateLimitConfigForm
                      config={validator.config}
                      onChange={(config) => updateRateLimitConfig(index, config)}
                    />
                  )}
                  <ValidatorConditionForm
                    condition={validator.condition}
                    onChange={(condition) => updateCondition(index, condition)}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== Auth Required Config Form ====================

interface AuthRequiredConfigFormProps {
  config: AuthRequiredConfig;
  onChange: (config: AuthRequiredConfig) => void;
}

function AuthRequiredConfigForm({ config, onChange }: AuthRequiredConfigFormProps) {
  const rolesString = (config.roles || []).join(', ');

  const handleRolesChange = (value: string) => {
    const roles = value
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    onChange({
      ...config,
      roles: roles.length > 0 ? roles : undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="auth-roles" className="text-xs text-muted-foreground">
          Required Roles (optional, comma-separated)
        </Label>
        <Input
          id="auth-roles"
          value={rolesString}
          onChange={(e) => handleRolesChange(e.target.value)}
          placeholder="admin, editor, viewer"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to allow any authenticated user. Specify roles to restrict access to users with
          matching roles (any match grants access).
        </p>
      </div>
    </div>
  );
}

// ==================== Rate Limit Config Form ====================

interface RateLimitConfigFormProps {
  config: RateLimitConfig;
  onChange: (config: RateLimitConfig) => void;
}

// ==================== Validator Condition Form ====================

const CONDITION_OPS: { value: ValidatorConditionOperator; label: string }[] = [
  { value: 'exists', label: 'Exists' },
  { value: 'not_exists', label: 'Does Not Exist' },
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
];

interface ValidatorConditionFormProps {
  condition: ValidatorCondition | undefined;
  onChange: (condition: ValidatorCondition | undefined) => void;
}

function ValidatorConditionForm({ condition, onChange }: ValidatorConditionFormProps) {
  const needsValue = condition?.operator === 'equals' || condition?.operator === 'not_equals';

  if (!condition) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
        onClick={() =>
          onChange({ field: 'user.id', operator: 'exists' })
        }
      >
        <Filter className="h-3 w-3 mr-1" />
        Add Condition
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs text-muted-foreground">
            Only run when
          </Label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onChange(undefined)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className={`grid gap-2 ${needsValue ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <ExpressionInput
          value={condition.field}
          onChange={(field) => onChange({ ...condition, field })}
          placeholder="Select field"
        />
        <Select
          value={condition.operator}
          onValueChange={(op) => {
            const newCondition: ValidatorCondition = {
              ...condition,
              operator: op as ValidatorConditionOperator,
            };
            // Clear value when switching to exists/not_exists
            if (op === 'exists' || op === 'not_exists') {
              delete newCondition.value;
            }
            onChange(newCondition);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_OPS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsValue && (
          <Input
            value={condition.value || ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="Value"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {describeCondition(condition)}
      </p>
    </div>
  );
}

function describeCondition(condition: ValidatorCondition): string {
  const field = condition.field || '...';
  switch (condition.operator) {
    case 'exists':
      return `Runs only when ${field} is present.`;
    case 'not_exists':
      return `Runs only when ${field} is not present.`;
    case 'equals':
      return `Runs only when ${field} equals "${condition.value || '...'}"`;
    case 'not_equals':
      return `Runs only when ${field} does not equal "${condition.value || '...'}"`;
    default:
      return '';
  }
}

function RateLimitConfigForm({ config, onChange }: RateLimitConfigFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="rate-limit" className="text-xs text-muted-foreground">
            Max Requests
          </Label>
          <Input
            id="rate-limit"
            type="number"
            min={1}
            value={config.limit || 100}
            onChange={(e) =>
              onChange({
                ...config,
                limit: parseInt(e.target.value, 10) || 100,
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-window" className="text-xs text-muted-foreground">
            Window (seconds)
          </Label>
          <Input
            id="rate-window"
            type="number"
            min={1}
            value={config.windowSeconds || 60}
            onChange={(e) =>
              onChange({
                ...config,
                windowSeconds: parseInt(e.target.value, 10) || 60,
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-keyby" className="text-xs text-muted-foreground">
            Key By
          </Label>
          <Select
            value={config.keyBy || 'ip'}
            onValueChange={(v) =>
              onChange({
                ...config,
                keyBy: v as 'ip' | 'user' | 'ip+user',
              })
            }
          >
            <SelectTrigger id="rate-keyby">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ip">IP Address</SelectItem>
              <SelectItem value="user">User ID</SelectItem>
              <SelectItem value="ip+user">IP + User</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Limits requests to {config.limit || 100} per {config.windowSeconds || 60} seconds, tracked by{' '}
        {config.keyBy === 'user'
          ? 'user ID (requires authentication)'
          : config.keyBy === 'ip+user'
          ? 'IP address and user ID combination'
          : 'IP address'}
        .
      </p>
    </div>
  );
}
