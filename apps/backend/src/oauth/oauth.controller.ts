import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { getSession } from 'supertokens-node/recipe/session';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { PublicProjectAccess } from '../auth/decorators/public-project-access.decorator';
import { OAuthService } from './oauth.service';
import { OAuthError } from './oauth.errors';
import { ConsentDecisionDto, RegisterClientDto } from './oauth.dto';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/**
 * RFC 7591 registration bodies carry metadata CE does not model (`logo_uri`,
 * `contacts`, `software_id`, …) — the global pipe's `forbidNonWhitelisted`
 * would 400 on every one of them (claude.ai's registration did). Applied by
 * the route itself to its untyped body (a parameter pipe cannot override a
 * global one — Nest runs global pipes first): unknown fields are stripped,
 * and what fails validation is answered in the RFC's
 * `{ error: invalid_client_metadata, error_description }` shape.
 */
export function registerBodyPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    exceptionFactory: (errors) =>
      new OAuthError(
        'invalid_client_metadata',
        errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') ||
          'invalid client metadata',
      ),
  });
}

/**
 * CE's OAuth 2.1 authorization server on the admin host (ADR-0005). The
 * authorize step needs a member's SuperTokens session (the consent page is the
 * admin SPA); register/token/revoke are the client's, unauthenticated by design.
 */
@ApiTags('OAuth')
@Controller('api/oauth')
@PublicProjectAccess()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Dynamic client registration (RFC 7591) — public clients' })
  async register(
    // Untyped on purpose: the app-wide ValidationPipe (`forbidNonWhitelisted`) skips a
    // plain-object parameter, and global pipes run before any parameter pipe could
    // relax them — so the lenient validation happens here, on the raw body.
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set(NO_STORE);
    const dto = (await registerBodyPipe().transform(body, {
      type: 'body',
      metatype: RegisterClientDto,
    })) as RegisterClientDto;
    return this.oauth.registerClient(dto);
  }

  @Get('authorize')
  @ApiOperation({
    summary: 'Authorization endpoint (code + PKCE S256, RFC 8707 resource)',
    description:
      'Without a session: redirects to the admin login, which returns here. With one: redirects to the consent page.',
  })
  async authorize(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const session = await getSession(req, res, { sessionRequired: false }).catch(() => undefined);
    if (!session) {
      const back = req.originalUrl || req.url;
      res.redirect(302, `/login?redirect=${encodeURIComponent(back)}&tryRefresh=true`);
      return;
    }
    try {
      const { request } = await this.oauth.beginAuthorization(query);
      res.redirect(302, `/oauth/consent?request=${encodeURIComponent(request)}`);
    } catch (error) {
      if (
        error instanceof OAuthError &&
        query.redirect_uri &&
        error.error !== 'invalid_client' &&
        error.error !== 'invalid_request'
      ) {
        // The redirect_uri was validated before any of these can throw (OAuth 2.1 §4.1.2.1).
        const url = new URL(query.redirect_uri);
        url.searchParams.set('error', error.error);
        url.searchParams.set('error_description', error.description);
        if (query.state) url.searchParams.set('state', query.state);
        res.redirect(302, url.toString());
        return;
      }
      throw error;
    }
  }

  @Get('consent')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'What the consent page shows for a pending request' })
  async pending(@CurrentUser() user: CurrentUserData, @Query('request') request: string) {
    const p = await this.oauth.pendingFor(user.id, user.role, request ?? '');
    return {
      clientName: p.clientName,
      scopes: p.scopes,
      project: { id: p.projectId, slug: p.projectSlug, name: p.projectName },
      redirectHost: new URL(p.redirectUri).host,
      expiresAt: new Date(p.exp * 1000).toISOString(),
    };
  }

  @Post('consent')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The member approves (possibly narrowing the scopes) or denies' })
  decide(@CurrentUser() user: CurrentUserData, @Body() dto: ConsentDecisionDto) {
    return this.oauth.consent(user.id, user.role, dto.request, {
      approve: dto.approve,
      scopes: dto.scopes,
    });
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Token endpoint — authorization_code (PKCE) and refresh_token (rotating)',
  })
  async token(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set(NO_STORE);
    return this.oauth.token(bodyOf(req));
  }

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revocation (RFC 7009) — always 200' })
  async revoke(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set(NO_STORE);
    const token = String(bodyOf(req).token ?? '');
    if (token) await this.oauth.revoke(token).catch(() => undefined);
    return {};
  }
}

/** `application/x-www-form-urlencoded` (what RFC 6749 clients send) and JSON alike. */
function bodyOf(req: Request): Record<string, unknown> {
  const body = (req as Request & { body?: unknown }).body;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}
