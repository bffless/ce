import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { pathRedirects, domainMappings } from '../db/schema';
import { CreatePathRedirectDto } from './dto/create-path-redirect.dto';
import { UpdatePathRedirectDto } from './dto/update-path-redirect.dto';
import { NginxRegenerationService } from './nginx-regeneration.service';

@Injectable()
export class PathRedirectsService {
  private readonly logger = new Logger(PathRedirectsService.name);

  constructor(private readonly nginxRegenerationService: NginxRegenerationService) {}

  /**
   * Create a path redirect for a domain mapping.
   */
  async create(domainMappingId: string, dto: CreatePathRedirectDto, userId: string) {
    // 1. Verify domain mapping exists
    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainMappingId))
      .limit(1);

    if (!domainMapping) {
      throw new NotFoundException('Domain mapping not found');
    }

    // 2. Check for duplicate source path on same domain
    const [existingRedirect] = await db
      .select()
      .from(pathRedirects)
      .where(
        and(
          eq(pathRedirects.domainMappingId, domainMappingId),
          eq(pathRedirects.sourcePath, dto.sourcePath),
        ),
      )
      .limit(1);

    if (existingRedirect) {
      throw new ConflictException(
        `Path redirect for "${dto.sourcePath}" already exists on this domain`,
      );
    }

    // 3. Validate source path is not the same as target path
    if (dto.sourcePath === dto.targetPath) {
      throw new ConflictException('Source path cannot be the same as target path');
    }

    // 4. Create redirect record
    const [redirect] = await db
      .insert(pathRedirects)
      .values({
        domainMappingId,
        sourcePath: dto.sourcePath,
        targetPath: dto.targetPath,
        redirectType: dto.redirectType || '301',
        isActive: dto.isActive ?? true,
        priority: dto.priority || '100',
        createdBy: userId,
      })
      .returning();

    // 5. Regenerate nginx config if redirect is active
    if (redirect.isActive) {
      try {
        await this.regenerateNginxConfig(domainMappingId);
      } catch (error) {
        // Rollback: delete redirect from database
        this.logger.error(`Failed to regenerate nginx config, rolling back: ${error}`);
        await db.delete(pathRedirects).where(eq(pathRedirects.id, redirect.id));
        throw error;
      }
    }

    this.logger.log(
      `Created path redirect: ${dto.sourcePath} → ${dto.targetPath} for domain ${domainMapping.domain}`,
    );

    return {
      ...redirect,
      domain: domainMapping.domain,
    };
  }

  /**
   * Get all path redirects for a domain mapping.
   */
  async findByDomain(domainMappingId: string, _userId: string) {
    const redirects = await db
      .select({
        redirect: pathRedirects,
        domain: domainMappings.domain,
      })
      .from(pathRedirects)
      .innerJoin(domainMappings, eq(pathRedirects.domainMappingId, domainMappings.id))
      .where(eq(pathRedirects.domainMappingId, domainMappingId))
      .orderBy(pathRedirects.priority);

    return redirects.map((r) => ({
      ...r.redirect,
      domain: r.domain,
    }));
  }

  /**
   * Get a single path redirect by ID.
   */
  async findOne(id: string, _userId: string) {
    const [result] = await db
      .select({
        redirect: pathRedirects,
        domain: domainMappings.domain,
      })
      .from(pathRedirects)
      .innerJoin(domainMappings, eq(pathRedirects.domainMappingId, domainMappings.id))
      .where(eq(pathRedirects.id, id))
      .limit(1);

    if (!result) {
      throw new NotFoundException(`Path redirect with ID ${id} not found`);
    }

    return {
      ...result.redirect,
      domain: result.domain,
    };
  }

  /**
   * Update a path redirect.
   */
  async update(id: string, dto: UpdatePathRedirectDto, userId: string) {
    const existing = await this.findOne(id, userId);

    // Check for duplicate source path if changing it
    if (dto.sourcePath && dto.sourcePath !== existing.sourcePath) {
      const [duplicate] = await db
        .select()
        .from(pathRedirects)
        .where(
          and(
            eq(pathRedirects.domainMappingId, existing.domainMappingId),
            eq(pathRedirects.sourcePath, dto.sourcePath),
          ),
        )
        .limit(1);

      if (duplicate) {
        throw new ConflictException(
          `Path redirect for "${dto.sourcePath}" already exists on this domain`,
        );
      }
    }

    // Validate source path is not the same as target path
    const newSourcePath = dto.sourcePath || existing.sourcePath;
    const newTargetPath = dto.targetPath || existing.targetPath;
    if (newSourcePath === newTargetPath) {
      throw new ConflictException('Source path cannot be the same as target path');
    }

    const [updated] = await db
      .update(pathRedirects)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(pathRedirects.id, id))
      .returning();

    // Regenerate nginx config if relevant fields changed
    if (
      dto.sourcePath !== undefined ||
      dto.targetPath !== undefined ||
      dto.redirectType !== undefined ||
      dto.isActive !== undefined
    ) {
      try {
        await this.regenerateNginxConfig(existing.domainMappingId);
      } catch (error) {
        this.logger.warn(`Failed to regenerate nginx config: ${error}`);
        // Don't fail the update - just log the warning
      }
    }

    return {
      ...updated,
      domain: existing.domain,
    };
  }

  /**
   * Delete a path redirect.
   */
  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);

    await db.delete(pathRedirects).where(eq(pathRedirects.id, id));

    // Regenerate nginx config to remove the redirect
    try {
      await this.regenerateNginxConfig(existing.domainMappingId);
    } catch (error) {
      this.logger.warn(`Failed to regenerate nginx config after removal: ${error}`);
    }

    this.logger.log(`Deleted path redirect: ${existing.sourcePath} from domain ${existing.domain}`);

    return { success: true };
  }

  /**
   * Get all active path redirects for a domain (used by nginx config generation).
   */
  async getActiveRedirectsForDomain(domainMappingId: string) {
    return db
      .select()
      .from(pathRedirects)
      .where(
        and(eq(pathRedirects.domainMappingId, domainMappingId), eq(pathRedirects.isActive, true)),
      )
      .orderBy(pathRedirects.priority);
  }

  /**
   * Regenerate nginx config for a domain mapping.
   * This triggers a full regeneration which will include path redirects.
   */
  private async regenerateNginxConfig(domainMappingId: string) {
    // Get the domain mapping to regenerate its config
    const [domainMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainMappingId))
      .limit(1);

    if (!domainMapping) {
      return;
    }

    // Trigger regeneration for this domain
    await this.nginxRegenerationService.regenerateForDomain(domainMappingId);
  }
}
