import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { OAuthService } from './oauth.service';
import { AppTokensModule } from '../app-tokens/app-tokens.module';

@Module({
  imports: [AppTokensModule],
  controllers: [OAuthController, OAuthMetadataController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
