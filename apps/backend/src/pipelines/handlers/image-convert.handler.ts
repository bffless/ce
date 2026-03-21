import { Injectable, Inject, Logger } from '@nestjs/common';
import { StepHandler, ImageConvertHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import * as path from 'path';

const FORMAT_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Image Convert Handler
 *
 * Reads an image from storage, converts it to a different format using sharp,
 * and writes the converted file back to storage. If the file is not an image
 * or is already in the target format, the step passes through without changes.
 */
@Injectable()
export class ImageConvertHandler implements StepHandler<ImageConvertHandlerConfig> {
  readonly type = 'image_convert_handler' as const;
  private readonly logger = new Logger(ImageConvertHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: ImageConvertHandlerConfig): void {
    if (!config.inputPath) {
      throw new ConfigurationError('inputPath is required', 'image_convert_handler');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as ImageConvertHandlerConfig;
    const stepName = step.name || 'image_convert_handler';
    const outputFormat = config.outputFormat || 'png';
    const quality = config.quality ?? 90;

    // Resolve the input storage path expression
    const inputPath = this.expressionEvaluator.evaluateExpression(
      config.inputPath,
      context,
      stepName,
    );

    if (!inputPath || typeof inputPath !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT_PATH',
          message: `inputPath expression "${config.inputPath}" resolved to ${inputPath === null ? 'null' : typeof inputPath}, expected a storage path string`,
        },
      };
    }

    // Download file from storage
    let fileBuffer: Buffer;
    try {
      const result = await this.storageAdapter.download(inputPath);
      if (Buffer.isBuffer(result)) {
        fileBuffer = result;
      } else if (result && typeof (result as any).pipe === 'function') {
        // Handle stream response
        const chunks: Buffer[] = [];
        for await (const chunk of result as AsyncIterable<Buffer>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fileBuffer = Buffer.concat(chunks);
      } else {
        fileBuffer = Buffer.from(result as any);
      }
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: `Could not read file from storage: ${inputPath}`,
        },
      };
    }

    // Detect current format from extension
    const ext = path.extname(inputPath).toLowerCase().replace('.', '');
    const currentMime = FORMAT_MIME[ext] || this.guessMimeFromExtension(ext);

    // Pass through if already in target format or not an image
    if (!currentMime.startsWith('image/') || ext === outputFormat) {
      this.logger.debug(
        `Skipping conversion: ${!currentMime.startsWith('image/') ? 'not an image' : 'already ' + outputFormat}`,
      );
      return {
        success: true,
        output: {
          storage_path: inputPath,
          content_type: currentMime,
          size: fileBuffer.length,
          converted: false,
        },
      };
    }

    // Convert using sharp
    try {
      const sharp = (await import('sharp')).default;
      let pipeline = sharp(fileBuffer);

      switch (outputFormat) {
        case 'png':
          pipeline = pipeline.png();
          break;
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality });
          break;
      }

      const convertedBuffer = await pipeline.toBuffer();

      // Build new storage path with updated extension
      const basePath = inputPath.replace(/\.[^.]+$/, '');
      const newStoragePath = `${basePath}.${outputFormat}`;
      const newMime = FORMAT_MIME[outputFormat];

      // Upload converted file
      await this.storageAdapter.upload(convertedBuffer, newStoragePath, {
        mimeType: newMime,
      });

      this.logger.debug(
        `Converted ${ext} → ${outputFormat} (${fileBuffer.length} → ${convertedBuffer.length} bytes)`,
      );

      return {
        success: true,
        output: {
          storage_path: newStoragePath,
          content_type: newMime,
          size: convertedBuffer.length,
          original_size: fileBuffer.length,
          converted: true,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'CONVERSION_FAILED',
          message: `Image conversion failed: ${(err as Error).message}`,
        },
      };
    }
  }

  private guessMimeFromExtension(ext: string): string {
    const mimes: Record<string, string> = {
      heic: 'image/heic',
      heif: 'image/heif',
      avif: 'image/avif',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      gif: 'image/gif',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      jpg: 'image/jpeg',
    };
    return mimes[ext] || 'application/octet-stream';
  }
}
