import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { PublicProjectAccess } from '../auth/decorators/public-project-access.decorator';
import { AppTokensService } from './app-tokens.service';
import {
  CreateAppTokenDto,
  CreateAppTokenResponse,
  ListAppTokensQueryDto,
  ListAppTokensResponse,
} from './app-tokens.dto';

/**
 * A member's app tokens. Session-only on purpose: a credential cannot beget
 * credentials (no API key and no token may mint a token). Cross-project like
 * `/api/me/*`, hence `@PublicProjectAccess()` (membership scoping, not auth).
 */
@ApiTags('App Tokens')
@ApiBearerAuth()
@Controller('api/app-tokens')
@UseGuards(SessionAuthGuard)
@PublicProjectAccess()
export class AppTokensController {
  constructor(private readonly appTokens: AppTokensService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Mint an app token',
    description:
      'Mints a scoped, project-bound bearer token for the calling member. The raw token is returned once. Any member of the project may mint one — a token never elevates.',
  })
  @ApiResponse({ status: 201, description: 'Token minted' })
  @ApiResponse({ status: 403, description: 'Not a member of the project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateAppTokenDto,
  ): Promise<CreateAppTokenResponse> {
    const { view, raw } = await this.appTokens.create(user.id, user.role, dto);
    return { data: view, token: raw };
  }

  @Get()
  @ApiOperation({
    summary: 'List my app tokens',
    description:
      'Newest first, one page per call: follow `nextCursor` (as `?cursor=`) until it is null. Revoked and expired tokens are omitted unless `includeInactive=true`.',
  })
  async list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListAppTokensQueryDto,
  ): Promise<ListAppTokensResponse> {
    const { items, nextCursor } = await this.appTokens.listMine(user.id, query);
    return { data: items, nextCursor };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one of my app tokens' })
  @ApiResponse({ status: 204, description: 'Revoked (or already revoked)' })
  @ApiResponse({ status: 404, description: 'Not one of the caller’s tokens' })
  async revoke(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.appTokens.revoke(id, user.id);
  }
}
