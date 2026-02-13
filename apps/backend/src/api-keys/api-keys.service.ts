import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, like, count, asc, desc } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { db } from '../db/client';
import { apiKeys, ApiKey, projects } from '../db/schema';
import {
  CreateApiKeyDto,
  UpdateApiKeyDto,
  ListApiKeysQueryDto,
  ApiKeyResponseDto,
  ApiKeySortField,
  SortOrder,
} from './api-keys.dto';
import { ProjectsService } from '../projects/projects.service';
import { PermissionsService } from '../permissions/permissions.service';

// Type for API key with joined project data
interface ApiKeyWithProject extends ApiKey {
  project?: {
    id: string;
    owner: string;
    name: string;
  } | null;
}

const BCRYPT_ROUNDS = 10;
const API_KEY_PREFIX = 'wsa_';
const API_KEY_LENGTH = 32; // 32 bytes = 64 hex characters

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Create a new API key for a user
   * @param userId - The user creating the API key
   * @param dto - API key creation data
   * @param userRole - The authenticated user's role (for global key creation check)
   * @returns The created API key details and the raw key (shown only once)
   */
  async create(
    userId: string,
    dto: CreateApiKeyDto,
    userRole?: string,
  ): Promise<{ apiKey: ApiKeyResponseDto; rawKey: string }> {
    let projectId: string | null = null;
    let projectData: { id: string; owner: string; name: string } | null = null;

    // Handle global API key creation
    if (dto.isGlobal) {
      // Only admin users can create global API keys
      if (userRole !== 'admin') {
        throw new ForbiddenException('Only admin users can create global API keys');
      }
      // projectId remains null for global keys
    } else {
      // Parse repository string (new way) or fallback to allowedRepositories (legacy)
      const repository = dto.repository || dto.allowedRepositories?.[0];

      if (!repository) {
        throw new BadRequestException('Repository is required for project-scoped API keys');
      }

      const [owner, name] = repository.split('/');
      if (!owner || !name) {
        throw new BadRequestException('Invalid repository format. Expected "owner/repo"');
      }

      // Lookup project
      const project = await this.projectsService.getProjectByOwnerName(owner, name);
      projectId = project.id;
      projectData = { id: project.id, owner: project.owner, name: project.name };

      // Check user has contributor+ access to project
      const projectRole = await this.permissionsService.getUserProjectRole(userId, project.id);
      if (!projectRole || !['owner', 'admin', 'contributor'].includes(projectRole)) {
        throw new ForbiddenException(
          'You do not have permission to create API keys for this project',
        );
      }
    }

    // Generate a cryptographically secure random key
    const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
    const rawKey = API_KEY_PREFIX + randomBytes.toString('hex');

    // Hash the key for storage
    const hashedKey = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    // Insert the new API key
    const [newApiKey] = await db
      .insert(apiKeys)
      .values({
        name: dto.name,
        key: hashedKey,
        userId,
        projectId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      })
      .returning();

    return {
      apiKey: this.toApiKeyResponse({ ...newApiKey, project: projectData }),
      rawKey,
    };
  }

  /**
   * List API keys for a user with pagination and filtering
   * @param userId - The user whose API keys to list
   * @param query - Query parameters for filtering and pagination
   * @returns Paginated list of API keys
   */
  async findAll(userId: string, query: ListApiKeysQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = ApiKeySortField.CREATED_AT,
      sortOrder = SortOrder.DESC,
    } = query;
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [eq(apiKeys.userId, userId)];

    if (search) {
      conditions.push(like(apiKeys.name, `%${search}%`));
    }

    const whereClause = and(...conditions);

    // Get total count
    const [{ value: total }] = await db.select({ value: count() }).from(apiKeys).where(whereClause);

    // Get sort column
    const sortColumn = this.getSortColumn(sortBy);
    const orderBy = sortOrder === SortOrder.ASC ? asc(sortColumn) : desc(sortColumn);

    // Get paginated results with project join for display
    const results = await db
      .select({
        apiKey: apiKeys,
        project: {
          id: projects.id,
          owner: projects.owner,
          name: projects.name,
        },
      })
      .from(apiKeys)
      .leftJoin(projects, eq(apiKeys.projectId, projects.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data: results.map((row) =>
        this.toApiKeyResponse({
          ...row.apiKey,
          project: row.project,
        }),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get a single API key by ID
   * @param id - The API key ID
   * @param userId - The requesting user's ID
   * @returns The API key details
   */
  async findOne(id: string, userId: string): Promise<ApiKeyResponseDto> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Check if user owns this API key
    if (apiKey.userId !== userId) {
      throw new ForbiddenException('You do not have access to this API key');
    }

    return this.toApiKeyResponse(apiKey);
  }

  /**
   * Update an API key
   * @param id - The API key ID
   * @param userId - The requesting user's ID
   * @param dto - Update data
   * @returns The updated API key details
   */
  async update(id: string, userId: string, dto: UpdateApiKeyDto): Promise<ApiKeyResponseDto> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Check if user owns this API key
    if (apiKey.userId !== userId) {
      throw new ForbiddenException('You do not have access to this API key');
    }

    // Build update object
    const updateData: Partial<{
      name: string;
      allowedRepositories: string | null;
      expiresAt: Date | null;
    }> = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    if (dto.allowedRepositories !== undefined) {
      updateData.allowedRepositories = dto.allowedRepositories
        ? JSON.stringify(dto.allowedRepositories)
        : null;
    }

    if (dto.expiresAt !== undefined) {
      updateData.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    // Update if there's something to update
    if (Object.keys(updateData).length > 0) {
      const [updatedApiKey] = await db
        .update(apiKeys)
        .set(updateData)
        .where(eq(apiKeys.id, id))
        .returning();

      return this.toApiKeyResponse(updatedApiKey);
    }

    return this.toApiKeyResponse(apiKey);
  }

  /**
   * Delete (revoke) an API key
   * @param id - The API key ID
   * @param userId - The requesting user's ID
   */
  async remove(id: string, userId: string): Promise<void> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Check if user owns this API key
    if (apiKey.userId !== userId) {
      throw new ForbiddenException('You do not have access to this API key');
    }

    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  /**
   * Convert an API key entity to a response DTO
   */
  private toApiKeyResponse(apiKey: ApiKeyWithProject): ApiKeyResponseDto {
    // Phase 3H.7: allowedRepositories field removed - now using projectId
    // Return null for backward compatibility
    const allowedRepositories: string[] | null = null;

    // Check if expired
    const isExpired = apiKey.expiresAt ? new Date() > new Date(apiKey.expiresAt) : false;

    // Global keys have null projectId
    const isGlobal = apiKey.projectId === null;

    return {
      id: apiKey.id,
      name: apiKey.name,
      userId: apiKey.userId,
      projectId: apiKey.projectId || null,
      allowedRepositories,
      expiresAt: apiKey.expiresAt ? apiKey.expiresAt.toISOString() : null,
      lastUsedAt: apiKey.lastUsedAt ? apiKey.lastUsedAt.toISOString() : null,
      isExpired,
      isGlobal,
      project: apiKey.project || null,
      createdAt: apiKey.createdAt.toISOString(),
    };
  }

  /**
   * Get the sort column based on the sort field
   */
  private getSortColumn(sortBy: ApiKeySortField) {
    switch (sortBy) {
      case ApiKeySortField.NAME:
        return apiKeys.name;
      case ApiKeySortField.LAST_USED_AT:
        return apiKeys.lastUsedAt;
      case ApiKeySortField.EXPIRES_AT:
        return apiKeys.expiresAt;
      case ApiKeySortField.CREATED_AT:
      default:
        return apiKeys.createdAt;
    }
  }
}
