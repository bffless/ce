import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PreviousStep } from './AvailableVariables';
import { useSecretNames } from '../SecretsContext';

interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  previousSteps?: PreviousStep[];
  className?: string;
}

interface Suggestion {
  value: string;
  description?: string;
  category: string;
}

/**
 * Input with autocomplete for pipeline expressions.
 * Shows suggestions when typing "data." or similar patterns.
 */
export function ExpressionInput({
  value,
  onChange,
  placeholder = 'Expression',
  previousSteps = [],
  className,
}: ExpressionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const secretNames = useSecretNames();

  // Generate all available suggestions
  const allSuggestions = useMemo(() => {
    const suggestions: Suggestion[] = [];

    // Project secrets (names only — values are write-only)
    for (const secretName of secretNames) {
      suggestions.push({
        value: `secrets.${secretName}`,
        description: 'Project secret',
        category: 'Secrets',
      });
    }

    // Request info (body first as most commonly used)
    suggestions.push(
      { value: 'request.body', description: 'POST/PUT body data', category: 'Request' },
      { value: 'request.query', description: 'Query params object', category: 'Request' },
      { value: 'request.method', description: 'GET, POST, etc.', category: 'Request' },
      { value: 'request.path', description: 'URL path', category: 'Request' },
      { value: 'request.ip', description: 'Client IP address', category: 'Request' },
      { value: 'request.userAgent', description: 'Browser/client info', category: 'Request' },
      { value: 'request.headers', description: 'All HTTP headers', category: 'Request' },
      { value: "request.headers['x-forwarded-for']", description: 'Original client IP (proxied)', category: 'Headers' },
      { value: "request.headers['x-real-ip']", description: 'Real client IP', category: 'Headers' },
      { value: "request.headers['referer']", description: 'Referring page URL', category: 'Headers' },
      { value: "request.headers['origin']", description: 'Request origin', category: 'Headers' },
    );

    // User info
    suggestions.push(
      { value: 'user.id', description: 'User ID', category: 'User' },
      { value: 'user.email', description: 'User email', category: 'User' },
      { value: 'user.role', description: 'User role', category: 'User' },
    );

    // Deployment context
    suggestions.push(
      { value: 'deployment.alias', description: 'Current alias name', category: 'Deployment' },
      { value: 'deployment.owner', description: 'Project owner', category: 'Deployment' },
      { value: 'deployment.repo', description: 'Project name', category: 'Deployment' },
    );

    // Previous steps
    for (const step of previousSteps) {
      const stepName = step.name;
      const needsBrackets = /\s/.test(stepName);
      const stepPath = needsBrackets ? `steps['${stepName}']` : `steps.${stepName}`;

      suggestions.push({
        value: stepPath,
        description: `Output from "${stepName}"`,
        category: 'Steps',
      });

      // Add common sub-paths based on handler type
      if (step.handlerType === 'data_query') {
        const isSingle = (step.config as Record<string, unknown>)?.single ||
                         (step.config as Record<string, unknown>)?.recordId;
        if (isSingle) {
          suggestions.push(
            { value: `${stepPath}.id`, description: 'Record ID', category: 'Steps' },
          );
        } else {
          suggestions.push(
            { value: `${stepPath}[0]`, description: 'First record', category: 'Steps' },
            { value: `${stepPath}.length`, description: 'Record count', category: 'Steps' },
          );
        }
      } else if (step.handlerType === 'data_create' || step.handlerType === 'data_update') {
        suggestions.push(
          { value: `${stepPath}.id`, description: 'Record ID', category: 'Steps' },
        );
      } else if (step.handlerType === 'form_handler') {
        // Add field names if available
        const fields = (step.config as Record<string, unknown>)?.fields;
        if (fields && typeof fields === 'object') {
          for (const fieldName of Object.keys(fields)) {
            suggestions.push({
              value: `${stepPath}.${fieldName}`,
              description: `Form field "${fieldName}"`,
              category: 'Steps',
            });
          }
        }
      } else if (step.handlerType === 'file_upload_handler') {
        suggestions.push(
          { value: `${stepPath}.storage_path`, description: 'Full storage key', category: 'Steps' },
          { value: `${stepPath}.url`, description: 'Internal URL path', category: 'Steps' },
          { value: `${stepPath}.content_type`, description: 'MIME type (e.g., image/png)', category: 'Steps' },
          { value: `${stepPath}.filename`, description: 'Sanitized filename', category: 'Steps' },
          { value: `${stepPath}.size`, description: 'File size in bytes', category: 'Steps' },
          { value: `${stepPath}.original_name`, description: 'Original filename', category: 'Steps' },
          { value: `${stepPath}.id`, description: 'Record ID', category: 'Steps' },
        );
      } else if (step.handlerType === 'replicate') {
        suggestions.push(
          { value: `${stepPath}.output`, description: 'Model output (URL, array, object, etc.)', category: 'Steps' },
          { value: `${stepPath}.output[0]`, description: 'First output (for array results)', category: 'Steps' },
          { value: `${stepPath}.predictionId`, description: 'Prediction ID', category: 'Steps' },
          { value: `${stepPath}.model`, description: 'Model that was run', category: 'Steps' },
          { value: `${stepPath}.status`, description: 'Prediction status', category: 'Steps' },
          { value: `${stepPath}.metrics`, description: 'Timing metrics', category: 'Steps' },
        );
      }
    }

    return suggestions;
  }, [previousSteps, secretNames]);

  // Ensure value is always a string
  const safeValue = typeof value === 'string' ? value : String(value ?? '');

  // Filter suggestions based on current input
  const filteredSuggestions = useMemo(() => {
    if (!safeValue) {
      // Show all suggestions when input is empty but focused
      return allSuggestions.slice(0, 10);
    }

    const lowerValue = safeValue.toLowerCase();

    return allSuggestions.filter((s) =>
      s.value.toLowerCase().includes(lowerValue) ||
      s.value.toLowerCase().startsWith(lowerValue)
    ).slice(0, 10); // Limit to 10 suggestions
  }, [safeValue, allSuggestions]);

  // Reset selected index when input value changes (new search)
  useEffect(() => {
    setSelectedIndex(0);
  }, [safeValue]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
      case 'Tab':
        if (filteredSuggestions[selectedIndex]) {
          e.preventDefault();
          onChange(filteredSuggestions[selectedIndex].value);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowSuggestions(true);
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    onChange(suggestion.value);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        ref={inputRef}
        value={safeValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        className="w-full"
        autoComplete="off"
      />

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.value}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className={cn(
                'w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center justify-between gap-2',
                index === selectedIndex && 'bg-accent',
              )}
            >
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {suggestion.value}
              </code>
              {suggestion.description && (
                <span className="text-xs text-muted-foreground truncate">
                  {suggestion.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
