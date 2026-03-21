import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { ExpressionInput } from './ExpressionInput';
import type { EmbedStoreHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Partial<EmbedStoreHandlerConfig>;
  onChange: (config: EmbedStoreHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

export function EmbedStoreConfig({ config, onChange, projectId, previousSteps = [] }: Props) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [recordId, setRecordId] = useState(config.recordId || '');
  const [fieldName, setFieldName] = useState(config.fieldName || '');
  const [embedding, setEmbedding] = useState(config.embedding || '');
  const [chunks, setChunks] = useState(config.chunks || '');
  const [metadata, setMetadata] = useState(config.metadata || '');
  const [chunkedMode, setChunkedMode] = useState(!!config.chunks);

  useEffect(() => {
    const updated: EmbedStoreHandlerConfig = {
      schemaId,
      recordId,
      fieldName,
      ...(chunkedMode
        ? { chunks: chunks || undefined }
        : { embedding: embedding || undefined }),
      ...(metadata ? { metadata } : {}),
    };
    onChange(updated);
  }, [schemaId, recordId, fieldName, embedding, chunks, metadata, chunkedMode]);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Schema</Label>
        <p className="text-xs text-muted-foreground mb-1">
          The schema that the target pipeline_data record belongs to
        </p>
        <SchemaPicker
          projectId={projectId}
          value={schemaId}
          onChange={setSchemaId}
        />
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Record ID</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p>Expression resolving to the pipeline_data record ID. Usually from a previous data_create step, e.g. <code>steps.create_record.id</code></p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ExpressionInput
          value={recordId}
          onChange={setRecordId}
          placeholder="steps.create_record.id"
          previousSteps={previousSteps}
        />
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Field Name</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p>Logical name for this embedding (e.g. "clip_embedding", "text_embedding"). Used to group embeddings for search — must match the fieldName in vector_search.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Input
          value={fieldName}
          onChange={(e) => setFieldName(e.target.value)}
          placeholder="clip_embedding"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={chunkedMode}
          onCheckedChange={setChunkedMode}
        />
        <Label className="text-sm">Chunked mode (1:N embeddings per record)</Label>
      </div>

      {chunkedMode ? (
        <div>
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Chunks Expression</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>Expression resolving to an array of objects: <code>{'[{ embedding: number[], text?: string, metadata?: object }]'}</code></p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ExpressionInput
            value={chunks}
            onChange={setChunks}
            placeholder="steps.chunk_and_embed.output"
            previousSteps={previousSteps}
          />
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Embedding Expression</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>Expression resolving to a number[] (the embedding vector). E.g. from a Replicate CLIP step: <code>steps.replicate_clip.output</code></p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ExpressionInput
            value={embedding}
            onChange={setEmbedding}
            placeholder="steps.replicate_clip.output"
            previousSteps={previousSteps}
          />
        </div>
      )}

      <div>
        <Label className="text-sm font-medium text-muted-foreground">Metadata (optional)</Label>
        <ExpressionInput
          value={metadata}
          onChange={setMetadata}
          placeholder="steps.extract_meta.output"
          previousSteps={previousSteps}
        />
      </div>
    </div>
  );
}
