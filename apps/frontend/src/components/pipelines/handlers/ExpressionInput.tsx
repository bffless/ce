import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PreviousStep } from './AvailableVariables';

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

  // Generate all available suggestions
  const allSuggestions = useMemo(() => {
    const suggestions: Suggestion[] = [];

    // Input data
    suggestions.push({
      value: 'input',
      description: 'Form data or JSON body',
      category: 'Input',
    });

    // User info
    suggestions.push(
      { value: 'user.id', description: 'User ID', category: 'User' },
      { value: 'user.email', description: 'User email', category: 'User' },
      { value: 'user.role', description: 'User role', category: 'User' },
    );

    // Request info
    suggestions.push(
      { value: 'request.method', description: 'GET, POST, etc.', category: 'Request' },
      { value: 'request.path', description: 'URL path', category: 'Request' },
      { value: 'request.query', description: 'Query params object', category: 'Request' },
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
      }
    }

    return suggestions;
  }, [previousSteps]);

  // Filter suggestions based on current input
  const filteredSuggestions = useMemo(() => {
    if (!value) {
      // Show all suggestions when input is empty but focused
      return allSuggestions.slice(0, 10);
    }

    const lowerValue = value.toLowerCase();

    return allSuggestions.filter((s) =>
      s.value.toLowerCase().includes(lowerValue) ||
      s.value.toLowerCase().startsWith(lowerValue)
    ).slice(0, 10); // Limit to 10 suggestions
  }, [value, allSuggestions]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredSuggestions]);

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
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        className={className}
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
