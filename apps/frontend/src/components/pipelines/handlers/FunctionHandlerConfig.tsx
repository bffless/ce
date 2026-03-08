import { useCallback, useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Code, Clock, Shield, ChevronDown, ChevronRight } from 'lucide-react';
import type { FunctionHandlerConfig as FunctionConfig } from './types';
import type { PreviousStep } from './AvailableVariables';
import { functionTemplates, getTemplatesByCategory, categoryNames } from './function-templates';
import type { Monaco } from '@monaco-editor/react';
import type { editor, Position } from 'monaco-editor';

// Lazy load Monaco Editor to reduce initial bundle size
const Editor = lazy(() => import('@monaco-editor/react'));

// Default code template shown when adding a new function handler
const DEFAULT_CODE = `/**
 * Transform your data in the handler function.
 * Type 'data.' to see available properties with autocomplete.
 */
function handler(data) {
  // Access input fields: data.input.fieldName
  // Access user info: data.user?.email
  // Access previous steps: data.steps['Step Name']

  return {
    ...data.input,
    processedAt: new Date().toISOString(),
  };
}
`;

interface FunctionHandlerConfigProps {
  config: Record<string, unknown>;
  onChange: (config: FunctionConfig) => void;
  /** Previous steps in the pipeline for generating type definitions */
  previousSteps?: PreviousStep[];
}

interface StepCompletionItem {
  name: string;
  insertText: string;
  type: string;
  documentation: string;
  fields: Array<{ name: string; type: string }>;
}

interface CompletionItems {
  steps: StepCompletionItem[];
}

/**
 * Get output type info for a handler type
 * NOTE: Defined before buildCompletionItems because const declarations aren't hoisted
 */
const getHandlerOutputInfo = (
  handlerType: string,
  config?: Record<string, unknown>,
): {
  type: string;
  documentation: string;
  fields: Array<{ name: string; type: string }>;
} => {
  // For form_handler, extract actual field names from config
  if (handlerType === 'form_handler' && config?.fields) {
    const formFields = config.fields as Record<string, { type: string }>;
    const fields = Object.entries(formFields).map(([name, fieldConfig]) => ({
      name,
      type: fieldConfig.type || 'string',
    }));
    return {
      type: 'FormOutput',
      documentation: 'Validated and typed form fields',
      fields,
    };
  }

  // For data create/update, extract field mappings from config
  if ((handlerType === 'data_create' || handlerType === 'data_update') && config?.fields) {
    const dataFields = config.fields as Record<string, string>;
    const fields: Array<{ name: string; type: string }> = [{ name: 'id', type: 'string' }];
    Object.keys(dataFields).forEach((fieldName) => {
      fields.push({ name: fieldName, type: 'any' });
    });
    if (handlerType === 'data_create') {
      fields.push({ name: 'createdAt', type: 'string' });
    } else {
      fields.push({ name: 'updatedAt', type: 'string' });
    }
    return {
      type: handlerType === 'data_create' ? 'CreatedRecord' : 'UpdatedRecord',
      documentation:
        handlerType === 'data_create' ? 'Created record with id and fields' : 'Updated record(s)',
      fields,
    };
  }

  // Default fallbacks when no config available
  switch (handlerType) {
    case 'form_handler':
      return {
        type: 'FormOutput',
        documentation: 'Validated and typed form fields',
        fields: [],
      };
    case 'data_create':
      return {
        type: 'CreatedRecord',
        documentation: 'Created record with id and fields',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'createdAt', type: 'string' },
        ],
      };
    case 'data_query':
      return {
        type: 'QueryResult[]',
        documentation: 'Array of matching records',
        fields: [
          { name: 'length', type: 'number' },
          { name: '[0]', type: 'Record' },
        ],
      };
    case 'data_update':
      return {
        type: 'UpdatedRecord',
        documentation: 'Updated record(s)',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'updatedAt', type: 'string' },
        ],
      };
    case 'data_delete':
      return {
        type: 'DeleteResult',
        documentation: 'Deletion result',
        fields: [
          { name: 'deleted', type: 'boolean' },
          { name: 'count', type: 'number' },
        ],
      };
    case 'email_handler':
      return {
        type: 'EmailResult',
        documentation: 'Email send result',
        fields: [
          { name: 'sent', type: 'boolean' },
          { name: 'messageId', type: 'string' },
        ],
      };
    case 'function_handler':
      return {
        type: 'any',
        documentation: 'Custom return value from handler()',
        fields: [],
      };
    case 'aggregate_handler':
      return {
        type: 'AggregateResult',
        documentation: 'Aggregation result',
        fields: [{ name: 'result', type: 'number | array' }],
      };
    default:
      return {
        type: 'unknown',
        documentation: 'Step output',
        fields: [],
      };
  }
};

/**
 * Build completion items based on previous steps
 */
const buildCompletionItems = (previousSteps: PreviousStep[]): CompletionItems => {
  const steps: StepCompletionItem[] = previousSteps.map((step) => {
    const { type, documentation, fields } = getHandlerOutputInfo(step.handlerType, step.config);
    // Use bracket notation for names with spaces/special chars
    const needsBrackets = /[^a-zA-Z0-9_]/.test(step.name);
    const insertText = needsBrackets ? `['${step.name}']` : step.name;

    return {
      name: step.name,
      insertText,
      type,
      documentation,
      fields,
    };
  });

  return { steps };
};

/**
 * Configuration component for the Function Handler step.
 * Allows users to write custom JavaScript code for data transformations.
 */
export function FunctionHandlerConfig({
  config,
  onChange,
  previousSteps = [],
}: FunctionHandlerConfigProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const typedConfig = config as Partial<FunctionConfig>;

  // Use default code template if no code is set
  const code = typedConfig.code ?? DEFAULT_CODE;
  const timeout = typedConfig.timeout ?? 5000;

  // Store monaco instance for registering completions
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  // Build completion items based on previous steps
  const completionItems = useMemo(() => {
    return buildCompletionItems(previousSteps);
  }, [previousSteps]);

  // Configure Monaco before it mounts
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    setMonacoInstance(monaco);

    // Disable JavaScript's built-in completions/diagnostics
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      noLib: true,
      allowNonTsExtensions: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
  }, []);

  // Register custom completion provider
  useEffect(() => {
    if (!monacoInstance) return;

    const provider = monacoInstance.languages.registerCompletionItemProvider('javascript', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        // Find the word being typed (after the last dot)
        const wordMatch = textUntilPosition.match(/\.(\w*)$/);
        const currentWord = wordMatch ? wordMatch[1] : '';
        const wordStartColumn = position.column - currentWord.length;

        const suggestions: Array<{
          label: string;
          kind: number;
          insertText: string;
          detail?: string;
          documentation?: string;
          sortText?: string;
        }> = [];

        const CompletionItemKind = monacoInstance.languages.CompletionItemKind;

        // After "data." (with optional partial word)
        if (/\bdata\.\w*$/.test(textUntilPosition)) {
          suggestions.push(
            {
              label: 'input',
              kind: CompletionItemKind.Property,
              insertText: 'input',
              detail: 'Record<string, any>',
              documentation: 'Form data or JSON body from the request',
              sortText: '0',
            },
            {
              label: 'user',
              kind: CompletionItemKind.Property,
              insertText: 'user',
              detail: 'User | undefined',
              documentation: 'Current authenticated user { id, email, role }',
              sortText: '1',
            },
            {
              label: 'request',
              kind: CompletionItemKind.Property,
              insertText: 'request',
              detail: 'RequestInfo',
              documentation: 'Request info { method, path, query }',
              sortText: '2',
            },
            {
              label: 'steps',
              kind: CompletionItemKind.Property,
              insertText: 'steps',
              detail: 'StepOutputs',
              documentation: 'Output from previous pipeline steps',
              sortText: '3',
            },
          );
        }
        // After "data.user." (with optional partial word)
        if (/\bdata\.user\.\w*$/.test(textUntilPosition)) {
          suggestions.push(
            {
              label: 'id',
              kind: CompletionItemKind.Property,
              insertText: 'id',
              detail: 'string',
              documentation: "User's unique identifier",
              sortText: '0',
            },
            {
              label: 'email',
              kind: CompletionItemKind.Property,
              insertText: 'email',
              detail: 'string',
              documentation: "User's email address",
              sortText: '1',
            },
            {
              label: 'role',
              kind: CompletionItemKind.Property,
              insertText: 'role',
              detail: 'string',
              documentation: "User's role",
              sortText: '2',
            },
          );
        }
        // After "data.request." (with optional partial word)
        if (/\bdata\.request\.\w*$/.test(textUntilPosition)) {
          suggestions.push(
            {
              label: 'method',
              kind: CompletionItemKind.Property,
              insertText: 'method',
              detail: 'string',
              documentation: 'HTTP method: GET, POST, PUT, PATCH, DELETE',
              sortText: '0',
            },
            {
              label: 'path',
              kind: CompletionItemKind.Property,
              insertText: 'path',
              detail: 'string',
              documentation: 'URL path',
              sortText: '1',
            },
            {
              label: 'query',
              kind: CompletionItemKind.Property,
              insertText: 'query',
              detail: 'Record<string, string>',
              documentation: 'Query parameters object',
              sortText: '2',
            },
          );
        }
        // After "data.steps." (with optional partial word)
        if (/\bdata\.steps\.\w*$/.test(textUntilPosition)) {
          for (let i = 0; i < completionItems.steps.length; i++) {
            const item = completionItems.steps[i];
            suggestions.push({
              label: item.name,
              kind: CompletionItemKind.Property,
              insertText: item.insertText,
              detail: item.type,
              documentation: item.documentation,
              sortText: String(i).padStart(3, '0'),
            });
          }
        }
        // After "data.steps['StepName']." or "data.steps.stepName." (with optional partial word)
        for (const item of completionItems.steps) {
          // Escape special regex characters in name, keep underscores for dot notation
          const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(
            `\\bdata\\.steps\\['${escapedName}'\\]\\.\\w*$|\\bdata\\.steps\\.${escapedName}\\.\\w*$`,
          );
          if (pattern.test(textUntilPosition)) {
            for (let i = 0; i < item.fields.length; i++) {
              const field = item.fields[i];
              suggestions.push({
                label: field.name,
                kind: CompletionItemKind.Field,
                insertText: field.name,
                detail: field.type,
                documentation: `Field from ${item.name} step`,
                sortText: `!${String(i).padStart(3, '0')}`, // '!' prefix to sort before other suggestions
                filterText: field.name,
              });
            }
            break;
          }
        }

        // Only return if we have suggestions
        if (suggestions.length === 0) {
          return { suggestions: [] };
        }

        // Return suggestions with proper range to replace the partial word
        return {
          incomplete: true, // Tell Monaco not to cache/merge with other providers
          suggestions: suggestions.map((s) => ({
            ...s,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: wordStartColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          })),
        };
      },
    });

    return () => {
      provider.dispose();
    };
  }, [monacoInstance, completionItems]);

  // Initialize with default code if empty
  useEffect(() => {
    if (typedConfig.code === undefined || typedConfig.code === '') {
      onChange({
        ...typedConfig,
        code: DEFAULT_CODE,
      } as FunctionConfig);
    }
  }, []); // Only run once on mount

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      onChange({
        ...typedConfig,
        code: value || '',
      } as FunctionConfig);
    },
    [typedConfig, onChange],
  );

  const handleTimeoutChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        onChange({
          ...typedConfig,
          timeout: Math.min(Math.max(value, 1000), 30000),
        } as FunctionConfig);
      }
    },
    [typedConfig, onChange],
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const template = functionTemplates.find((t) => t.id === templateId);
      if (template) {
        onChange({
          ...typedConfig,
          code: template.code,
        } as FunctionConfig);
      }
    },
    [typedConfig, onChange],
  );

  const templatesByCategory = getTemplatesByCategory();

  return (
    <div className="space-y-4">
      {/* Template Picker */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Code className="h-4 w-4" />
          Code Templates
        </Label>
        <div className="border rounded-md">
          {Object.entries(templatesByCategory).map(([category, templates]) => (
            <div key={category} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                <span>{categoryNames[category] || category}</span>
                {expandedCategory === category ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {expandedCategory === category && (
                <div className="px-3 pb-2 space-y-1">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleTemplateSelect(template.id)}
                      className="block w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                    >
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs text-muted-foreground">{template.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Code Editor */}
      <div className="space-y-2">
        <Label htmlFor="code">JavaScript Code</Label>
        <div className="border rounded-md overflow-hidden">
          <Suspense
            fallback={
              <div className="h-[300px] flex items-center justify-center bg-muted/50">
                <div className="text-muted-foreground">Loading editor...</div>
              </div>
            }
          >
            <Editor
              height="300px"
              defaultLanguage="javascript"
              value={code}
              onChange={handleCodeChange}
              beforeMount={handleEditorWillMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                tabSize: 2,
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                // Disable word-based suggestions
                wordBasedSuggestions: 'off',
              }}
            />
          </Suspense>
        </div>
        <p className="text-xs text-muted-foreground">
          Write JavaScript code that returns the transformed data. Use{' '}
          <code className="bg-muted px-1 rounded">return</code> to output the result.
        </p>
      </div>

      {/* Timeout */}
      <div className="space-y-2">
        <Label htmlFor="timeout" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Timeout (ms)
        </Label>
        <Input
          id="timeout"
          type="number"
          value={timeout}
          onChange={handleTimeoutChange}
          min={1000}
          max={30000}
          step={1000}
        />
        <p className="text-xs text-muted-foreground">
          Maximum execution time (1000-30000ms). Default: 5000ms.
        </p>
      </div>

      {/* Security Notice */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription className="text-xs">
          <strong>Sandboxed Execution:</strong> Code runs in an isolated environment with access to{' '}
          <code className="bg-muted px-1 rounded">data.input</code>,{' '}
          <code className="bg-muted px-1 rounded">data.user</code>,{' '}
          <code className="bg-muted px-1 rounded">data.request</code>, and{' '}
          <code className="bg-muted px-1 rounded">data.steps</code>. Node.js APIs (require, process,
          etc.) are not available.
        </AlertDescription>
      </Alert>
    </div>
  );
}
