import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronsUpDown, Check, Plus, Trash2, Info, ExternalLink, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReplicateHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';
import { ExpressionInput } from './ExpressionInput';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

interface ModelInput {
  name: string;
  type: 'file' | 'text' | 'number' | 'boolean';
  required: boolean;
  description: string;
  defaultExpression?: string;
}

interface ModelPreset {
  id: string;
  label: string;
  description: string;
  inputs: ModelInput[];
  /** Description of what .output contains */
  outputDescription: string;
  /** Example of the raw output shape */
  outputExample: string;
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'andreasjansson/clip-features',
    label: 'CLIP Embeddings',
    description: 'Generate CLIP feature vectors from text or images',
    inputs: [
      {
        name: 'inputs',
        type: 'text',
        required: true,
        description: 'Text string to embed',
        defaultExpression: 'request.body.text',
      },
    ],
    outputDescription: 'Array of objects with embedding vectors',
    outputExample: '[{ embedding: [0.1, 0.2, ...], input: "text" }]',
  },
  {
    id: 'beautyyuyanli/multilingual-e5-large',
    label: 'Text Embeddings (E5)',
    description: 'Multilingual text embeddings for semantic search',
    inputs: [
      {
        name: 'texts',
        type: 'text',
        required: true,
        description: 'JSON array of texts to embed, e.g. ["hello world"]',
        defaultExpression: 'request.body.texts',
      },
    ],
    outputDescription: 'Array of embedding vectors (one per input text)',
    outputExample: '[[0.013, -0.028, 0.051, ...]]',
  },
  {
    id: 'black-forest-labs/flux-schnell',
    label: 'Image Generation (Flux)',
    description: 'Fast high-quality image generation from text',
    inputs: [
      {
        name: 'prompt',
        type: 'text',
        required: true,
        description: 'Text description of the image to generate',
        defaultExpression: 'request.body.prompt',
      },
      {
        name: 'num_outputs',
        type: 'number',
        required: false,
        description: 'Number of images (1-4)',
        defaultExpression: '1',
      },
      {
        name: 'aspect_ratio',
        type: 'text',
        required: false,
        description: 'e.g., 1:1, 16:9, 4:3',
        defaultExpression: '1:1',
      },
    ],
    outputDescription: 'Array of image URLs (expire after 1 hour)',
    outputExample: '["https://replicate.delivery/...png"]',
  },
  {
    id: 'lucataco/remove-bg',
    label: 'Background Removal',
    description: 'Remove background from an image',
    inputs: [
      {
        name: 'image',
        type: 'file',
        required: true,
        description: 'Image file to process',
        defaultExpression: 'steps.upload.storage_path',
      },
    ],
    outputDescription: 'Image URL of the result (expires after 1 hour)',
    outputExample: '"https://replicate.delivery/...png"',
  },
  {
    id: 'datalab-to/marker',
    label: 'PDF to Text',
    description: 'Extract structured text from a PDF document',
    inputs: [
      {
        name: 'document',
        type: 'file',
        required: true,
        description: 'PDF document to extract',
        defaultExpression: 'steps.upload.storage_path',
      },
    ],
    outputDescription: 'Extracted text in markdown format',
    outputExample: '"# Document Title\\n\\nParagraph text..."',
  },
  {
    id: 'vaibhavs10/incredibly-fast-whisper',
    label: 'Speech Transcription',
    description: 'Transcribe speech from an audio file',
    inputs: [
      {
        name: 'audio',
        type: 'file',
        required: true,
        description: 'Audio file to transcribe',
        defaultExpression: 'steps.upload.storage_path',
      },
      {
        name: 'task',
        type: 'text',
        required: false,
        description: '"transcribe" or "translate"',
        defaultExpression: 'transcribe',
      },
    ],
    outputDescription: 'Object with transcribed text and segments',
    outputExample: '{ text: "Hello world", chunks: [...] }',
  },
];

function getModelUrl(modelId: string): string {
  return `https://replicate.com/${modelId}`;
}

export function ReplicateHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [model, setModel] = useState(typedConfig.model || '');
  const [version, setVersion] = useState(typedConfig.version || '');
  const [inputEntries, setInputEntries] = useState<[string, string][]>(() => {
    const input = typedConfig.input || {};
    const entries = Object.entries(input);
    return entries.length > 0 ? entries : [['', '']];
  });
  const [outputField, setOutputField] = useState(typedConfig.outputField || '');
  const [timeoutMs, setTimeoutMs] = useState<number | ''>(typedConfig.timeout ?? '');
  const [modelOpen, setModelOpen] = useState(false);

  // Sync to parent
  useEffect(() => {
    const input: Record<string, string> = {};
    for (const [key, value] of inputEntries) {
      if (key.trim()) {
        input[key.trim()] = value;
      }
    }

    const newConfig: Config = {
      model,
      input,
      ...(version ? { version } : {}),
      ...(outputField ? { outputField } : {}),
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    };

    onChangeRef.current(newConfig);
  }, [model, version, inputEntries, outputField, timeoutMs]);

  const selectPreset = useCallback((preset: ModelPreset) => {
    setModel(preset.id);
    // Pre-fill required inputs with their default expressions
    const requiredInputs = preset.inputs.filter((i) => i.required);
    setInputEntries(requiredInputs.map((i) => [i.name, i.defaultExpression || '']));
    setModelOpen(false);
  }, []);

  const addInputEntry = () => {
    setInputEntries((prev) => [...prev, ['', '']]);
  };

  const removeInputEntry = (index: number) => {
    setInputEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateInputKey = (index: number, key: string) => {
    setInputEntries((prev) => prev.map((entry, i) => (i === index ? [key, entry[1]] : entry)));
  };

  const updateInputValue = (index: number, value: string) => {
    setInputEntries((prev) => prev.map((entry, i) => (i === index ? [entry[0], value] : entry)));
  };

  const selectedPreset = MODEL_PRESETS.find((p) => p.id === model);
  const hasFileInputs = selectedPreset?.inputs.some((i) => i.type === 'file') ?? false;

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="space-y-2">
        <Label>Model</Label>
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={modelOpen}
              className="w-full justify-between font-normal"
            >
              {model ? (
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm">{model}</span>
                  {selectedPreset && (
                    <span className="text-xs text-muted-foreground">({selectedPreset.label})</span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">Select or type a model...</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[500px] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search or type model name..."
                value={model}
                onValueChange={setModel}
              />
              <CommandList>
                <CommandEmpty>
                  <div className="py-2 text-sm text-muted-foreground">
                    Using custom model: <span className="font-mono">{model}</span>
                  </div>
                </CommandEmpty>
                <CommandGroup heading="Text Input Models">
                  {MODEL_PRESETS.filter((p) => p.inputs.every((i) => i.type !== 'file')).map(
                    (preset) => (
                      <CommandItem
                        key={preset.id}
                        value={preset.id}
                        onSelect={() => selectPreset(preset)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            model === preset.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{preset.label}</span>
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {preset.id}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {preset.description}
                          </span>
                        </div>
                      </CommandItem>
                    ),
                  )}
                </CommandGroup>
                <CommandGroup heading="File Input Models (pair with File Upload step)">
                  {MODEL_PRESETS.filter((p) => p.inputs.some((i) => i.type === 'file')).map(
                    (preset) => (
                      <CommandItem
                        key={preset.id}
                        value={preset.id}
                        onSelect={() => selectPreset(preset)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            model === preset.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{preset.label}</span>
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {preset.id}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {preset.description}
                          </span>
                        </div>
                      </CommandItem>
                    ),
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {model ? (
            <a
              href={getModelUrl(model)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View model on Replicate
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span>
              Select a preset or type any model from{' '}
              <a
                href="https://replicate.com/explore"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                replicate.com/explore
              </a>
            </span>
          )}
        </div>
      </div>

      {/* Model reference (when a preset is selected) */}
      {selectedPreset && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Inputs</p>
            <div className="space-y-1">
              {selectedPreset.inputs.map((input) => (
                <div key={input.name} className="flex items-start gap-2 text-xs">
                  <code className="px-1.5 py-0.5 rounded bg-muted font-mono shrink-0">
                    {input.name}
                  </code>
                  <span className="text-muted-foreground">
                    {input.description}
                    {input.required && <span className="text-destructive ml-1">*</span>}
                    {input.type === 'file' && (
                      <span className="ml-1 text-blue-600 dark:text-blue-400">(file)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {selectedPreset.inputs.some((i) => !i.required) && (
              <p className="text-xs text-muted-foreground italic">
                Optional inputs can be added with "+ Add Field" below.{' '}
                <a
                  href={getModelUrl(selectedPreset.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  See all inputs
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </p>
            )}
          </div>
          <div className="border-t pt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Output</p>
            <p className="text-xs text-muted-foreground">{selectedPreset.outputDescription}</p>
            <code className="block text-[11px] bg-muted px-2 py-1 rounded font-mono text-muted-foreground">
              {selectedPreset.outputExample}
            </code>
          </div>
        </div>
      )}

      {/* Version */}
      <div className="space-y-2">
        <Label>
          Version {!version && <span className="text-yellow-600 font-normal">(recommended)</span>}
        </Label>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="e.g., 95fcc2a26d3899cd6c2691c900465aaeff..."
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Pin a version hash for deterministic results and faster execution.
          {model && (
            <>
              {' '}
              Find versions on the{' '}
              <a
                href={`${getModelUrl(model)}/versions`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                model page
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
              .
            </>
          )}
          {!version && ' Without a version, the latest is resolved on each run (extra API call).'}
        </p>
      </div>

      {/* Input Mappings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Input Mappings</Label>
          <Button variant="ghost" size="sm" onClick={addInputEntry}>
            <Plus className="h-4 w-4 mr-1" />
            Add Field
          </Button>
        </div>
        <div className="space-y-2">
          {inputEntries.map(([key, value], index) => {
            // Find matching preset input for this key to show description
            const presetInput = selectedPreset?.inputs.find((i) => i.name === key);
            return (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={key}
                    onChange={(e) => updateInputKey(index, e.target.value)}
                    placeholder="input name"
                    className="flex-1 font-mono text-sm"
                  />
                  <span className="text-muted-foreground">=</span>
                  <ExpressionInput
                    value={value}
                    onChange={(v) => updateInputValue(index, v)}
                    placeholder={
                      presetInput?.type === 'file'
                        ? 'steps.upload.storage_path'
                        : 'e.g., request.body.text'
                    }
                    previousSteps={previousSteps}
                    className="flex-1"
                  />
                  {inputEntries.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeInputEntry(index)}
                      className="text-destructive hover:text-destructive px-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {presetInput && (
                  <p className="text-xs text-muted-foreground pl-1">
                    {presetInput.description}
                    {presetInput.type === 'file' &&
                      ' — automatically uploaded to Replicate from storage'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {hasFileInputs && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              File inputs: use{' '}
              <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 font-mono">
                steps.&lt;upload_step&gt;.storage_path
              </code>{' '}
              to reference an uploaded file. It's automatically read from storage and uploaded to
              Replicate — no public URL needed.
            </span>
          </div>
        )}
      </div>

      {/* Output Field (optional) */}
      <div className="space-y-2">
        <Label>Output Field (optional)</Label>
        <Input
          value={outputField}
          onChange={(e) => setOutputField(e.target.value)}
          placeholder="e.g., embedding"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Extract a specific key from the model output. Leave empty to use the full output.
        </p>
      </div>

      {/* Timeout (optional) */}
      <div className="space-y-2">
        <Label htmlFor="replicate-timeout" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Timeout (ms) <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="replicate-timeout"
          type="number"
          value={timeoutMs}
          onChange={(e) => {
            const v = e.target.value;
            setTimeoutMs(v === '' ? '' : parseInt(v, 10) || '');
          }}
          placeholder="30000"
          min={1000}
          max={300000}
          step={1000}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Max time to wait for the prediction. Default 30000ms. Slow models (e.g. large LLMs with
          high thinking effort) may need more. Note: values above ~60s also require raising{' '}
          <code className="font-mono">proxy_read_timeout</code> in your nginx config, or the request
          is cut short at the proxy.
        </p>
      </div>
    </div>
  );
}
