import { Module, forwardRef } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthService } from './oauth.service';
import { AppTokensModule } from '../app-tokens/app-tokens.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';

@Module({
  // forwardRef: ProxyRulesModule → PipelinesModule → OAuthModule (the
  // oauth_protected_resource step names the issuer); RFC 8707 `resource`
  // resolution reads that step's config through RuleInvokerService.
  imports: [AppTokensModule, PermissionsModule, forwardRef(() => ProxyRulesModule)],
  controllers: [OAuthController, OAuthMetadataController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
