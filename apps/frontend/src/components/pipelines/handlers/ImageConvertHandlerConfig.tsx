import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExpressionInput } from './ExpressionInput';
import type { ImageConvertHandlerConfig as Config } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

export function ImageConvertHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typedConfig = config as unknown as Partial<Config>;

  const [inputPath, setInputPath] = useState(typedConfig.inputPath || '');
  const [outputFormat, setOutputFormat] = useState<'png' | 'jpeg' | 'webp'>(typedConfig.outputFormat || 'png');
  const [quality, setQuality] = useState<number | undefined>(typedConfig.quality);

  useEffect(() => {
    onChange({
      inputPath,
      outputFormat,
      quality: outputFormat !== 'png' ? quality : undefined,
    });
  }, [inputPath, outputFormat, quality, onChange]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Input Storage Path</Label>
        <ExpressionInput
          value={inputPath}
          onChange={setInputPath}
          placeholder="e.g., steps.upload.storage_path"
          previousSteps={previousSteps}
        />
        <p className="text-xs text-muted-foreground">
          Expression resolving to the storage path of the file to convert.
          Typically references a previous file upload step's <code>storage_path</code> output.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Output Format</Label>
        <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as 'png' | 'jpeg' | 'webp')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="png">PNG</SelectItem>
            <SelectItem value="jpeg">JPEG</SelectItem>
            <SelectItem value="webp">WebP</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Target format. If the file is already in this format or is not an image, it passes through unchanged.
        </p>
      </div>

      {outputFormat !== 'png' && (
        <div className="space-y-2">
          <Label>Quality (1-100)</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={quality ?? ''}
            onChange={(e) => setQuality(e.target.value ? Number(e.target.value) : undefined)}
            placeholder="90"
          />
          <p className="text-xs text-muted-foreground">
            Quality for lossy formats. Default: 90.
          </p>
        </div>
      )}

      {/* Step Output Reference */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Step output (available to subsequent steps)
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storage_path</code>
          <span className="text-muted-foreground">Converted file storage key</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">content_type</code>
          <span className="text-muted-foreground">Output MIME type</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">size</code>
          <span className="text-muted-foreground">Output file size in bytes</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">converted</code>
          <span className="text-muted-foreground">Whether conversion was performed</span>
        </div>
      </div>
    </div>
  );
}
