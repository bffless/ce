import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { SchemaPicker } from './SchemaPicker';
import { ExpressionInput } from './ExpressionInput';
import type { VectorSearchHandlerConfig } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Partial<VectorSearchHandlerConfig>;
  onChange: (config: VectorSearchHandlerConfig) => void;
  projectId: string;
  previousSteps?: PreviousStep[];
}

export function VectorSearchConfig({ config, onChange, projectId, previousSteps = [] }: Props) {
  const [schemaId, setSchemaId] = useState(config.schemaId || '');
  const [fieldName, setFieldName] = useState(config.fieldName || '');
  const [queryVector, setQueryVector] = useState(config.queryVector || '');
  const [limit, setLimit] = useState(config.limit ?? 10);
  const [threshold, setThreshold] = useState(config.threshold ?? '');
  const [selectFields, setSelectFields] = useState(config.select ? config.select.join(', ') : '');

  useEffect(() => {
    const updated: VectorSearchHandlerConfig = {
      schemaId,
      fieldName,
      queryVector,
      limit,
      ...(threshold !== '' && threshold !== undefined ? { threshold: Number(threshold) } : {}),
      ...(selectFields.trim()
        ? {
            select: selectFields
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
    };
    onChange(updated);
  }, [schemaId, fieldName, queryVector, limit, threshold, selectFields]);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Schema</Label>
        <p className="text-xs text-muted-foreground mb-1">The schema to search embeddings within</p>
        <SchemaPicker projectId={projectId} value={schemaId} onChange={setSchemaId} />
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
                <p>Must match the fieldName used in the embed_store step (e.g. "clip_embedding")</p>
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

      <div>
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Query Vector</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p>
                  Expression resolving to number[] — the embedding to search by. E.g. from a
                  Replicate CLIP step: <code>steps.replicate_clip.output</code>
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ExpressionInput
          value={queryVector}
          onChange={setQueryVector}
          placeholder="steps.replicate_clip.output"
          previousSteps={previousSteps}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-medium">Limit</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
          />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Threshold</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>
                    Minimum cosine similarity (0-1). Results below this are excluded. Leave empty to
                    return all results up to the limit.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="0.7"
          />
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium text-muted-foreground">
          Select Fields (optional, comma-separated)
        </Label>
        <Input
          value={selectFields}
          onChange={(e) => setSelectFields(e.target.value)}
          placeholder="title, description, url"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Data fields to include in results. Leave empty for all fields.
        </p>
      </div>
    </div>
  );
}
