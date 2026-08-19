import { Injectable, Inject } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { getUserContext } from '../helpers/user-context.helper';
import { STORAGE_ADAPTER, IStorageAdapter } from '../../storage/storage.interface';

@Injectable()
export class StorageTools {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly authService: AuthService,
  ) {}

  @Tool({
    name: 'create_signed_url',
    description:
      'Generate a time-limited signed URL for a file in storage. Use this to download or view files (images, documents, etc.) stored in the platform. The storage path can be found in pipeline data records (e.g., the storage_path field from file uploads).',
    parameters: z.object({
      storagePath: z
        .string()
        .describe('Full storage path (e.g., "owner/repo/uploads/images/uuid-file.png")'),
      expiresIn: z
        .number()
        .optional()
        .describe('URL expiration in seconds (default 3600 = 1 hour)'),
    }),
  })
  async createSignedUrl(
    args: { storagePath: string; expiresIn?: number },
    _context: Context,
    request: Request,
  ) {
    await getUserContext(request, this.authService);
    const url = await this.storageAdapter.getUrl(args.storagePath, args.expiresIn ?? 3600);
    return JSON.stringify({
      url,
      storagePath: args.storagePath,
      expiresIn: args.expiresIn ?? 3600,
    });
  }
}
