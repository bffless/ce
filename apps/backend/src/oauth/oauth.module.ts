import { Module, forwardRef } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthService } from './oauth.service';
import { ClientMetadataService } from './client-metadata.service';
import { AppTokensModule } from '../app-tokens/app-tokens.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';

@Module({
  // forwardRef on every import: this module sits inside the require cycle
  // app → … → projects → pipelines → oauth → app-tokens → projects (#773).
  // Today AppTokensModule and PermissionsModule happen to be fully evaluated
  // by the time this decorator runs, but that depends on AppModule's import
  // order, which is reordered deliberately for route precedence. Deferring
  // all three means no reordering can bake `undefined` into this array.
  // ProxyRulesModule → PipelinesModule → OAuthModule is the original cycle
  // (the oauth_protected_resource step names the issuer; RFC 8707
  // `resource` resolution reads that step's config through RuleInvokerService).
  imports: [
    forwardRef(() => AppTokensModule),
    forwardRef(() => PermissionsModule),
    forwardRef(() => ProxyRulesModule),
  ],
  controllers: [OAuthController, OAuthMetadataController],
  providers: [OAuthService, ClientMetadataService],
  exports: [OAuthService],
})
export class OAuthModule {}
