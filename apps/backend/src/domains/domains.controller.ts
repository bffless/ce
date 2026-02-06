import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DomainsService } from './domains.service';
import { VisibilityService } from './visibility.service';
import { RedirectsService } from './redirects.service';
import { PathRedirectsService } from './path-redirects.service';
import { TrafficRoutingService } from './traffic-routing.service';
import { TrafficRulesService } from './traffic-rules.service';
import { SslInfoService } from './ssl-info.service';
import { SslRenewalService } from './ssl-renewal.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { CreateRedirectDto } from './dto/create-redirect.dto';
import { UpdateRedirectDto } from './dto/update-redirect.dto';
import { RedirectResponseDto } from './dto/redirect-response.dto';
import { CreatePathRedirectDto } from './dto/create-path-redirect.dto';
import { UpdatePathRedirectDto } from './dto/update-path-redirect.dto';
import { PathRedirectResponseDto } from './dto/path-redirect-response.dto';
import { DomainResponseDto, DomainVisibilityResponseDto } from './dto/domain-response.dto';
import { SetTrafficWeightsDto, TrafficConfigResponseDto } from './dto/traffic-weight.dto';
import {
  CreateTrafficRuleDto,
  UpdateTrafficRuleDto,
  TrafficRuleResponseDto,
} from './dto/traffic-rule.dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../feature-flags';

@ApiTags('Domains')
@Controller('api/domains')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class DomainsController {
  constructor(
    private readonly domainsService: DomainsService,
    private readonly visibilityService: VisibilityService,
    private readonly redirectsService: RedirectsService,
    private readonly pathRedirectsService: PathRedirectsService,
    private readonly trafficRoutingService: TrafficRoutingService,
    private readonly trafficRulesService: TrafficRulesService,
    private readonly sslInfoService: SslInfoService,
    private readonly sslRenewalService: SslRenewalService,
  ) {}

  // =====================
  // Wildcard SSL Endpoints
  // =====================

  @Post('ssl/wildcard/request')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Start wildcard certificate request (returns DNS challenge)' })
  @ApiResponse({ status: 200, description: 'DNS challenge returned' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  @ApiResponse({ status: 500, description: 'ACME client not initialized' })
  async requestWildcardCertificate() {
    return this.domainsService.startWildcardCertificateRequest();
  }

  @Post('ssl/wildcard/verify')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Verify DNS record and issue wildcard certificate' })
  @ApiResponse({ status: 200, description: 'Certificate issued' })
  @ApiResponse({ status: 400, description: 'Verification failed' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  async verifyWildcardCertificate() {
    return this.domainsService.completeWildcardCertificateRequest();
  }

  @Get('ssl/wildcard/status')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Get wildcard certificate status' })
  @ApiResponse({ status: 200, description: 'Certificate status returned' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  async getWildcardCertificateStatus() {
    return this.domainsService.getWildcardCertificateStatus();
  }

  @Get('ssl/wildcard/details')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Get wildcard certificate details with parsing info' })
  @ApiResponse({ status: 200, description: 'Wildcard certificate details' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  async getWildcardCertDetails() {
    return this.domainsService.getWildcardCertDetails();
  }

  @Get('ssl/wildcard/pending')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Get pending DNS challenge (if any)' })
  @ApiResponse({ status: 200, description: 'Pending challenge returned' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  async getPendingWildcardChallenge() {
    return this.domainsService.getPendingWildcardChallenge();
  }

  @Get('ssl/wildcard/check-dns')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Check DNS propagation for pending wildcard certificate' })
  @ApiResponse({ status: 200, description: 'DNS propagation status returned' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  async checkWildcardDnsPropagation() {
    return this.domainsService.checkWildcardDnsPropagation();
  }

  @Delete('ssl/wildcard')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Delete wildcard certificate' })
  @ApiResponse({ status: 200, description: 'Certificate deleted' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  async deleteWildcardCertificate() {
    return this.domainsService.deleteWildcardCertificate();
  }

  @Delete('ssl/wildcard/pending')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlags('ENABLE_WILDCARD_SSL')
  @ApiOperation({ summary: 'Cancel pending wildcard certificate request' })
  @ApiResponse({ status: 200, description: 'Pending request cancelled' })
  @ApiResponse({ status: 403, description: 'Feature disabled' })
  @ApiResponse({ status: 404, description: 'No pending request found' })
  async cancelPendingWildcardChallenge() {
    return this.domainsService.cancelPendingWildcardChallenge();
  }

  // =====================
  // Configuration Endpoint
  // =====================

  @Get('config')
  @ApiOperation({ summary: 'Get domains configuration (baseDomain, etc.)' })
  @ApiResponse({ status: 200, description: 'Configuration returned' })
  async getConfig() {
    const platformIp = await this.domainsService.getPlatformIp();
    return {
      baseDomain: process.env.PRIMARY_DOMAIN || 'localhost',
      mockSslMode: process.env.MOCK_SSL === 'true',
      platformIp,
    };
  }

  // =====================
  // Per-Domain SSL Endpoints
  // =====================

  @Post(':id/dns/verify')
  @ApiOperation({ summary: 'Verify DNS configuration for custom domain' })
  @ApiResponse({ status: 200, description: 'DNS verification result returned' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  async verifyDomainDns(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Req() request: Request,
  ) {
    // Extract JWT from SuperTokens cookie for Control Plane auth
    const authToken = (request.cookies as Record<string, string>)?.sAccessToken;
    return this.domainsService.verifyCustomDomainDns(id, userId, authToken);
  }

  @Get(':id/dns/status')
  @ApiOperation({ summary: 'Get DNS configuration requirements for custom domain' })
  @ApiResponse({ status: 200, description: 'DNS requirements returned' })
  async getDomainDnsRequirements(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const domain = await this.domainsService.findOne(id, userId);

    return {
      domain: domain.domain,
      domainType: domain.domainType,
      dnsVerified: domain.dnsVerified,
      dnsVerifiedAt: domain.dnsVerifiedAt,
      requirements:
        domain.domainType === 'custom'
          ? {
              recordType: 'A',
              host: '@',
              instructions: [
                `1. Go to your DNS provider for ${domain.domain}`,
                `2. Add an A record pointing to this server's IP address`,
                `3. Wait 1-5 minutes for DNS propagation`,
                `4. Click "Verify DNS"`,
              ],
            }
          : null,
    };
  }

  @Post(':id/ssl/request')
  @ApiOperation({ summary: 'Request SSL certificate for domain' })
  @ApiResponse({ status: 200, description: 'Certificate requested' })
  @ApiResponse({ status: 400, description: 'DNS not verified or wildcard cert missing' })
  async requestDomainSsl(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.domainsService.requestDomainSsl(id, userId);
  }

  @Get(':id/ssl/status')
  @ApiOperation({ summary: 'Get SSL status for domain' })
  @ApiResponse({ status: 200, description: 'SSL status returned' })
  async getDomainSslStatus(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.domainsService.getDomainSslStatus(id, userId);
  }

  // =====================
  // Phase B: SSL Certificate Details Endpoints
  // =====================

  @Get(':id/ssl/details')
  @ApiOperation({ summary: 'Get SSL certificate details for domain' })
  @ApiResponse({ status: 200, description: 'SSL certificate info' })
  async getSslDetails(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.domainsService.getDomainSslDetails(id, userId);
  }

  @Post(':id/ssl/renew')
  @ApiOperation({ summary: 'Manually renew SSL certificate' })
  @ApiResponse({ status: 200, description: 'Renewal result' })
  async renewCertificate(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.domainsService.manualRenewCertificate(id, userId);
  }

  @Patch(':id/ssl/auto-renew')
  @ApiOperation({ summary: 'Configure auto-renewal setting' })
  @ApiResponse({ status: 200, description: 'Updated setting' })
  async updateAutoRenew(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
    @CurrentUser('id') userId: string,
  ) {
    return this.domainsService.updateAutoRenewSetting(id, userId, body.enabled);
  }

  @Get(':id/ssl/history')
  @ApiOperation({ summary: 'Get SSL renewal history for domain' })
  @ApiResponse({ status: 200, description: 'Renewal history returned' })
  async getSslRenewalHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.sslRenewalService.getRenewalHistory(id, limit ? parseInt(limit) : 10);
  }

  // =====================
  // Phase B2: SSL Auto-Renewal Admin Endpoints
  // =====================

  @Get('ssl/history')
  @ApiOperation({ summary: 'Get all SSL renewal history (admin)' })
  @ApiResponse({ status: 200, description: 'All renewal history returned' })
  async getAllSslRenewalHistory(@Query('limit') limit?: string) {
    return this.sslRenewalService.getAllRenewalHistory(limit ? parseInt(limit) : 50);
  }

  @Get('ssl/settings')
  @ApiOperation({ summary: 'Get SSL auto-renewal settings' })
  @ApiResponse({ status: 200, description: 'SSL settings returned' })
  async getSslSettings() {
    return this.sslRenewalService.getSettings();
  }

  @Patch('ssl/settings')
  @ApiOperation({ summary: 'Update SSL auto-renewal settings' })
  @ApiResponse({ status: 200, description: 'SSL settings updated' })
  async updateSslSettings(
    @Body()
    body: {
      renewalThresholdDays?: number;
      notificationEmail?: string;
      wildcardAutoRenew?: boolean;
    },
  ) {
    await this.sslRenewalService.updateSettings(body);
    return this.sslRenewalService.getSettings();
  }

  @Post('ssl/renewal/trigger')
  @ApiOperation({ summary: 'Manually trigger SSL renewal check' })
  @ApiResponse({ status: 200, description: 'Renewal check triggered' })
  async triggerRenewalCheck() {
    await this.sslRenewalService.triggerRenewalCheck();
    return { message: 'Renewal check triggered' };
  }

  // =====================
  // Phase B5: Visibility Endpoints
  // =====================

  @Get(':id/visibility')
  @ApiOperation({ summary: 'Get resolved visibility for domain mapping' })
  @ApiResponse({ status: 200, type: DomainVisibilityResponseDto })
  async getDomainVisibility(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<DomainVisibilityResponseDto> {
    const domain = await this.domainsService.findOne(id, userId);
    const visibilityInfo = await this.visibilityService.getVisibilityInfo(domain);

    return {
      domainId: id,
      effectiveVisibility: visibilityInfo.effectiveVisibility ? 'public' : 'private',
      source: visibilityInfo.source,
      domainOverride: visibilityInfo.domainOverride,
      aliasVisibility: visibilityInfo.aliasVisibility,
      projectVisibility: visibilityInfo.projectVisibility,
    };
  }

  // =====================
  // Redirect Endpoints
  // =====================

  @Post(':id/redirects')
  @ApiOperation({ summary: 'Create redirect to this domain' })
  @ApiResponse({ status: 201, type: RedirectResponseDto })
  async createRedirect(
    @Param('id') targetDomainId: string,
    @Body() dto: CreateRedirectDto,
    @CurrentUser('id') userId: string,
  ): Promise<RedirectResponseDto> {
    return this.redirectsService.create(targetDomainId, dto, userId);
  }

  @Get(':id/redirects')
  @ApiOperation({ summary: 'List redirects to this domain' })
  @ApiResponse({ status: 200, type: [RedirectResponseDto] })
  async getRedirects(
    @Param('id') targetDomainId: string,
    @CurrentUser('id') userId: string,
  ): Promise<RedirectResponseDto[]> {
    return this.redirectsService.findByTargetDomain(targetDomainId, userId);
  }

  @Patch('redirects/:redirectId')
  @ApiOperation({ summary: 'Update redirect' })
  @ApiResponse({ status: 200, type: RedirectResponseDto })
  async updateRedirect(
    @Param('redirectId') redirectId: string,
    @Body() dto: UpdateRedirectDto,
    @CurrentUser('id') userId: string,
  ): Promise<RedirectResponseDto> {
    return this.redirectsService.update(redirectId, dto, userId);
  }

  @Delete('redirects/:redirectId')
  @ApiOperation({ summary: 'Delete redirect' })
  @ApiResponse({ status: 200 })
  async deleteRedirect(@Param('redirectId') redirectId: string, @CurrentUser('id') userId: string) {
    return this.redirectsService.remove(redirectId, userId);
  }

  // =====================
  // Path Redirect Endpoints
  // =====================

  @Post(':id/path-redirects')
  @ApiOperation({ summary: 'Create path redirect for this domain' })
  @ApiResponse({ status: 201, type: PathRedirectResponseDto })
  async createPathRedirect(
    @Param('id') domainMappingId: string,
    @Body() dto: CreatePathRedirectDto,
    @CurrentUser('id') userId: string,
  ): Promise<PathRedirectResponseDto> {
    return this.pathRedirectsService.create(domainMappingId, dto, userId);
  }

  @Get(':id/path-redirects')
  @ApiOperation({ summary: 'List path redirects for this domain' })
  @ApiResponse({ status: 200, type: [PathRedirectResponseDto] })
  async getPathRedirects(
    @Param('id') domainMappingId: string,
    @CurrentUser('id') userId: string,
  ): Promise<PathRedirectResponseDto[]> {
    return this.pathRedirectsService.findByDomain(domainMappingId, userId);
  }

  @Patch('path-redirects/:pathRedirectId')
  @ApiOperation({ summary: 'Update path redirect' })
  @ApiResponse({ status: 200, type: PathRedirectResponseDto })
  async updatePathRedirect(
    @Param('pathRedirectId') pathRedirectId: string,
    @Body() dto: UpdatePathRedirectDto,
    @CurrentUser('id') userId: string,
  ): Promise<PathRedirectResponseDto> {
    return this.pathRedirectsService.update(pathRedirectId, dto, userId);
  }

  @Delete('path-redirects/:pathRedirectId')
  @ApiOperation({ summary: 'Delete path redirect' })
  @ApiResponse({ status: 200 })
  async deletePathRedirect(
    @Param('pathRedirectId') pathRedirectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.pathRedirectsService.remove(pathRedirectId, userId);
  }

  // =====================
  // Phase C: Traffic Routing Endpoints
  // =====================

  @Get(':id/traffic')
  @ApiOperation({ summary: 'Get traffic routing configuration' })
  @ApiResponse({ status: 200, type: TrafficConfigResponseDto })
  async getTrafficConfig(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<TrafficConfigResponseDto> {
    return this.trafficRoutingService.getTrafficConfig(id, userId);
  }

  @Put(':id/traffic')
  @ApiOperation({ summary: 'Set traffic routing weights' })
  @ApiResponse({ status: 200, type: TrafficConfigResponseDto })
  async setTrafficWeights(
    @Param('id') id: string,
    @Body() dto: SetTrafficWeightsDto,
    @CurrentUser('id') userId: string,
  ): Promise<TrafficConfigResponseDto> {
    return this.trafficRoutingService.setTrafficWeights(id, dto, userId);
  }

  @Delete(':id/traffic')
  @ApiOperation({ summary: 'Clear traffic routing (return to single alias)' })
  @ApiResponse({ status: 200 })
  async clearTrafficWeights(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.trafficRoutingService.clearTrafficWeights(id, userId);
  }

  @Get(':id/traffic/aliases')
  @ApiOperation({ summary: 'Get available aliases for traffic routing' })
  @ApiResponse({ status: 200, type: [String] })
  async getAvailableAliases(@Param('id') id: string): Promise<string[]> {
    return this.trafficRoutingService.getAvailableAliases(id);
  }

  // =====================
  // Traffic Rules Endpoints
  // =====================

  @Get(':id/traffic/rules')
  @ApiOperation({ summary: 'List traffic rules for domain (by priority)' })
  @ApiResponse({ status: 200, type: [TrafficRuleResponseDto] })
  async getTrafficRules(
    @Param('id') domainId: string,
    @CurrentUser('id') userId: string,
  ): Promise<TrafficRuleResponseDto[]> {
    return this.trafficRulesService.findByDomain(domainId, userId);
  }

  @Post(':id/traffic/rules')
  @ApiOperation({ summary: 'Create a traffic rule' })
  @ApiResponse({ status: 201, type: TrafficRuleResponseDto })
  async createTrafficRule(
    @Param('id') domainId: string,
    @Body() dto: CreateTrafficRuleDto,
    @CurrentUser('id') userId: string,
  ): Promise<TrafficRuleResponseDto> {
    return this.trafficRulesService.create(domainId, dto, userId);
  }

  @Patch('traffic/rules/:ruleId')
  @ApiOperation({ summary: 'Update a traffic rule' })
  @ApiResponse({ status: 200, type: TrafficRuleResponseDto })
  async updateTrafficRule(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateTrafficRuleDto,
    @CurrentUser('id') userId: string,
  ): Promise<TrafficRuleResponseDto> {
    return this.trafficRulesService.update(ruleId, dto, userId);
  }

  @Delete('traffic/rules/:ruleId')
  @ApiOperation({ summary: 'Delete a traffic rule' })
  @ApiResponse({ status: 200 })
  async deleteTrafficRule(
    @Param('ruleId') ruleId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.trafficRulesService.remove(ruleId, userId);
  }

  // =====================
  // Domain CRUD Endpoints
  // =====================

  @Post()
  @ApiOperation({ summary: 'Create domain mapping' })
  @ApiResponse({ status: 201, type: DomainResponseDto })
  async create(
    @Body() createDomainDto: CreateDomainDto,
    @CurrentUser('id') userId: string,
    @Req() request: Request,
  ): Promise<DomainResponseDto> {
    // Extract JWT from SuperTokens cookie for Control Plane auth
    const authToken = (request.cookies as Record<string, string>)?.sAccessToken;
    const domain = await this.domainsService.create(createDomainDto, userId, authToken);
    return this.toResponseDto(domain);
  }

  @Get()
  @ApiOperation({ summary: 'List domain mappings' })
  @ApiResponse({ status: 200, type: [DomainResponseDto] })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('projectId') projectId?: string,
    @Query('domainType') domainType?: string,
    @Query('isActive') isActive?: string,
  ): Promise<DomainResponseDto[]> {
    const domains = await this.domainsService.findAll(userId, {
      projectId,
      domainType,
      isActive: isActive ? isActive === 'true' : undefined,
    });
    return domains.map((d) => this.toResponseDto(d));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get domain mapping details' })
  @ApiResponse({ status: 200, type: DomainResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<DomainResponseDto> {
    const domain = await this.domainsService.findOne(id, userId);
    return this.toResponseDto(domain);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update domain mapping' })
  @ApiResponse({ status: 200, type: DomainResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateDomainDto: UpdateDomainDto,
    @CurrentUser('id') userId: string,
  ): Promise<DomainResponseDto> {
    const domain = await this.domainsService.update(id, updateDomainDto, userId);
    return this.toResponseDto(domain);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete domain mapping' })
  @ApiResponse({ status: 200 })
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Req() request: Request,
  ) {
    // Extract JWT from SuperTokens cookie for Control Plane auth
    const authToken = (request.cookies as Record<string, string>)?.sAccessToken;
    return this.domainsService.remove(id, userId, authToken);
  }

  /**
   * Transform database model to DTO
   */
  private toResponseDto(domain: any): DomainResponseDto {
    return {
      id: domain.id,
      projectId: domain.projectId,
      alias: domain.alias,
      path: domain.path,
      domain: domain.domain,
      domainType: domain.domainType,
      isActive: domain.isActive,
      isPublic: domain.isPublic, // Phase B5: visibility override
      unauthorizedBehavior: domain.unauthorizedBehavior, // Phase B5: access control override
      requiredRole: domain.requiredRole, // Phase B5: access control override
      isPrimary: domain.isPrimary, // Primary domain flag
      isSpa: domain.isSpa, // SPA mode for client-side routing
      wwwBehavior: domain.wwwBehavior, // WWW/apex redirect behavior
      redirectTarget: domain.redirectTarget, // Target for redirect domains
      sslEnabled: domain.sslEnabled,
      sslExpiresAt: domain.sslExpiresAt,
      dnsVerified: domain.dnsVerified,
      dnsVerifiedAt: domain.dnsVerifiedAt,
      nginxConfigPath: domain.nginxConfigPath,
      createdBy: domain.createdBy,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
    };
  }
}
