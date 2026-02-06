import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db/client';
import { shareLinks, ShareLink, NewShareLink } from '../db/schema';
import { CreateShareLinkDto, UpdateShareLinkDto } from './dto';

@Injectable()
export class ShareLinksService {
  private readonly logger = new Logger(ShareLinksService.name);

  async create(dto: CreateShareLinkDto, userId: string): Promise<ShareLink> {
    if (!dto.projectId && !dto.domainMappingId) {
      throw new BadRequestException(
        'Either projectId or domainMappingId must be provided',
      );
    }

    const token = crypto.randomBytes(6).toString('base64url');

    const values = {
      projectId: dto.projectId || null,
      domainMappingId: dto.domainMappingId || null,
      token,
      label: dto.label || null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: userId,
    } satisfies NewShareLink;

    const [link] = await db.insert(shareLinks).values(values).returning();
    return link;
  }

  async getByProjectId(projectId: string): Promise<ShareLink[]> {
    return db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.projectId, projectId));
  }

  async getByDomainMappingId(domainMappingId: string): Promise<ShareLink[]> {
    return db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.domainMappingId, domainMappingId));
  }

  async getById(id: string): Promise<ShareLink | null> {
    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.id, id))
      .limit(1);
    return link || null;
  }

  async update(id: string, dto: UpdateShareLinkDto): Promise<ShareLink> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException('Share link not found');
    }

    const updateData: Partial<NewShareLink> = {
      updatedAt: new Date(),
    };

    if ('label' in dto) {
      updateData.label = dto.label || null;
    }
    if ('isActive' in dto) {
      updateData.isActive = dto.isActive;
    }
    if ('expiresAt' in dto) {
      updateData.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    const [updated] = await db
      .update(shareLinks)
      .set(updateData)
      .where(eq(shareLinks.id, id))
      .returning();

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException('Share link not found');
    }

    await db.delete(shareLinks).where(eq(shareLinks.id, id));
  }

  async regenerateToken(id: string): Promise<ShareLink> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundException('Share link not found');
    }

    const token = crypto.randomBytes(6).toString('base64url');

    const [updated] = await db
      .update(shareLinks)
      .set({ token, updatedAt: new Date() })
      .where(eq(shareLinks.id, id))
      .returning();

    return updated;
  }

  /**
   * Validate a share token for a given project and optional domain mapping.
   * Returns the share link if valid, null otherwise.
   * Increments useCount and updates lastUsedAt on successful validation.
   */
  async validateToken(
    token: string,
    projectId: string,
    domainMappingId?: string,
  ): Promise<ShareLink | null> {
    // First try domain-scoped link if domainMappingId provided
    if (domainMappingId) {
      const domainLink = await this.findAndValidateToken(
        token,
        null,
        domainMappingId,
      );
      if (domainLink) return domainLink;
    }

    // Fall back to project-scoped link
    return this.findAndValidateToken(token, projectId, null);
  }

  private async findAndValidateToken(
    token: string,
    projectId: string | null,
    domainMappingId: string | null,
  ): Promise<ShareLink | null> {
    const conditions = [
      eq(shareLinks.token, token),
      eq(shareLinks.isActive, true),
    ];

    if (projectId) {
      conditions.push(eq(shareLinks.projectId, projectId));
    }
    if (domainMappingId) {
      conditions.push(eq(shareLinks.domainMappingId, domainMappingId));
    }

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(and(...conditions))
      .limit(1);

    if (!link) return null;

    // Check expiration
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return null;
    }

    // Increment useCount and update lastUsedAt
    await db
      .update(shareLinks)
      .set({
        useCount: sql`${shareLinks.useCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(shareLinks.id, link.id));

    return link;
  }
}
