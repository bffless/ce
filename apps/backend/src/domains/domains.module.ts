import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { RedirectsService } from './redirects.service';
import { PathRedirectsService } from './path-redirects.service';
import { TrafficRoutingService } from './traffic-routing.service';
import { TrafficRulesService } from './traffic-rules.service';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { NginxStartupService } from './nginx-startup.service';
import { NginxRegenerationService } from './nginx-regeneration.service';
import { SslCertificateService } from './ssl-certificate.service';
import { SslInfoService } from './ssl-info.service';
import { SslRenewalService } from './ssl-renewal.service';
import { VisibilityService } from './visibility.service';
import { ProjectsModule } from '../projects/projects.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ProxyRulesModule } from '../proxy-rules/proxy-rules.module';

@Module({
  imports: [
    ProjectsModule,
    ScheduleModule.forRoot(),
    FeatureFlagsModule,
    forwardRef(() => ProxyRulesModule),
  ],
  controllers: [DomainsController],
  providers: [
    DomainsService,
    RedirectsService,
    PathRedirectsService,
    TrafficRoutingService,
    TrafficRulesService,
    NginxConfigService,
    NginxReloadService,
    NginxStartupService,
    NginxRegenerationService,
    SslCertificateService,
    SslInfoService,
    SslRenewalService,
    VisibilityService,
  ],
  exports: [
    DomainsService,
    RedirectsService,
    PathRedirectsService,
    TrafficRoutingService,
    TrafficRulesService,
    VisibilityService,
    NginxConfigService,
    NginxReloadService,
    NginxRegenerationService,
    SslInfoService,
    SslRenewalService,
  ],
})
export class DomainsModule implements OnModuleInit {
  private readonly logger = new Logger(DomainsModule.name);

  constructor(private readonly sslCertificateService: SslCertificateService) {}

  async onModuleInit() {
    // Initialize ACME client on startup
    // This is non-blocking - if it fails, SSL operations will fail gracefully
    try {
      await this.sslCertificateService.initialize();
      this.logger.log('SSL Certificate Service initialized');
    } catch (error) {
      this.logger.warn(`SSL Certificate Service initialization failed: ${error}`);
      this.logger.warn('SSL certificate operations will not be available');
    }

    // Note: NginxStartupService implements OnModuleInit and will
    // regenerate all nginx configs automatically after this module initializes
  }
}
