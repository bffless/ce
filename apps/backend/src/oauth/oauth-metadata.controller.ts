import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicProjectAccess } from '../auth/decorators/public-project-access.decorator';
import { OAuthService } from './oauth.service';

/** RFC 8414 — served at the issuer's root; the admin nginx vhost routes this one path to the backend. */
@ApiTags('OAuth')
@Controller('.well-known')
@PublicProjectAccess()
export class OAuthMetadataController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'OAuth 2.1 authorization-server metadata (RFC 8414)' })
  metadata() {
    return this.oauth.metadata();
  }
}
