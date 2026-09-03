import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { appTokens, projects } from '../db/schema';
import { mintToken } from '../auth/app-token.util';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';
import {
  APP_TOKEN_DEFAULT_TTL_DAYS,
  APP_TOKEN_MAX_TTL_DAYS,
  AppTokenView,
  CreateAppTokenDto,
} from './app-tokens.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mint, list and revoke app tokens. A token never elevates, so any member of
 * the project (role ≥ viewer, or a global admin) may mint one bound to it;
 * only a session may mint — a credential cannot beget credentials (the
 * controller's guard). OAuth (story 9) mints through the same `create`.
 */
@Injectable()
export class AppTokensService {
  private readonly logger = new Logger(AppTokensService.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async create(
    userId: string,
    userRole: string | undefined,
    dto: CreateAppTokenDto,
    opts: { kind?: 'personal' | 'oauth'; clientId?: string; expiresAt?: Date } = {},
  ): Promise<{ view: AppTokenView; raw: string }> {
    const [owner, name] = dto.project.split('/');
    let project: { id: string; owner: string; name: string };
    try {
      const found = await this.projectsService.getProjectByOwnerName(owner, name);
      project = { id: found.id, owner: found.owner, name: found.name };
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException('Project not found');
      throw error;
    }

    if (userRole !== 'admin') {
      const role = await this.permissionsService.getUserProjectRole(userId, project.id);
      if (!role || role === 'guest') {
        throw new ForbiddenException('You are not a member of this project');
      }
    }

    const expiresAt = opts.expiresAt ?? this.resolveExpiry(dto.expiresAt);
    const minted = mintToken();
    const [row] = await db
      .insert(appTokens)
      .values({
        name: dto.name,
        tokenHash: minted.hash,
        tokenPrefix: minted.prefix,
        userId,
        projectId: project.id,
        scopes: [...new Set(dto.scopes)],
        kind: opts.kind ?? 'personal',
        clientId: opts.clientId ?? null,
        expiresAt,
      })
      .returning();

    this.logger.log(`App token ${row.id} minted for user ${userId} on ${dto.project}`);
    return { view: this.toView(row, project), raw: minted.raw };
  }

  async listMine(userId: string): Promise<AppTokenView[]> {
    const rows = await db
      .select({
        token: appTokens,
        project: { id: projects.id, owner: projects.owner, name: projects.name },
      })
      .from(appTokens)
      .innerJoin(projects, eq(appTokens.projectId, projects.id))
      .where(eq(appTokens.userId, userId))
      .orderBy(desc(appTokens.createdAt));
    return rows.map((r) => this.toView(r.token, r.project));
  }

  /** Soft revoke; 404 unless the token is the caller's; idempotent on an already-revoked token. */
  async revoke(id: string, userId: string): Promise<void> {
    const [row] = await db
      .select()
      .from(appTokens)
      .where(and(eq(appTokens.id, id), eq(appTokens.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('App token not found');
    if (row.revokedAt) return;
    await db
      .update(appTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(appTokens.id, id), isNull(appTokens.revokedAt)));
    this.logger.log(`App token ${id} revoked by user ${userId}`);
  }

  private resolveExpiry(requested: string | undefined): Date {
    const now = Date.now();
    if (!requested) return new Date(now + APP_TOKEN_DEFAULT_TTL_DAYS * DAY_MS);
    const at = new Date(requested).getTime();
    if (Number.isNaN(at) || at <= now)
      throw new BadRequestException('expiresAt must be in the future');
    if (at > now + APP_TOKEN_MAX_TTL_DAYS * DAY_MS) {
      throw new BadRequestException(`expiresAt must be within ${APP_TOKEN_MAX_TTL_DAYS} days`);
    }
    return new Date(at);
  }

  private toView(
    row: typeof appTokens.$inferSelect,
    project: { id: string; owner: string; name: string },
  ): AppTokenView {
    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      project,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      kind: row.kind,
      clientId: row.clientId ?? null,
      expiresAt: iso(row.expiresAt),
      revokedAt: iso(row.revokedAt),
      lastUsedAt: iso(row.lastUsedAt),
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }
}
