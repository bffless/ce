import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../../feature-flags/feature-flag.guard';
import { PrimarySslService } from './primary-ssl.service';
import { PrimarySslApplyDto, PrimarySslPasteDto } from './primary-ssl.dto';

@ApiTags('Admin - Primary SSL')
@Controller('api/admin/ssl')
@UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard)
@Roles('admin')
@RequireFeatureFlags('ENABLE_PRIMARY_SSL_MANAGEMENT')
export class PrimarySslController {
  constructor(private readonly svc: PrimarySslService) {}

  @Get('status')
  status() { return this.svc.getStatus(); }

  @Post('preflight')
  @HttpCode(HttpStatus.OK)
  preflight() { return this.svc.preflight(); }

  @Post('certificate')
  @HttpCode(HttpStatus.OK)
  certificate(@Body() dto: PrimarySslPasteDto) { return this.svc.stagePaste(dto); }

  @Post('letsencrypt')
  @HttpCode(HttpStatus.OK)
  letsencrypt() { return this.svc.issueLetsEncrypt(); }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@Body() dto: PrimarySslApplyDto) { return this.svc.apply(dto); }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  confirm() { this.svc.confirm(); return { confirmed: true }; }

  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  rollback() { this.svc.rollback(); return { rolledBack: true }; }
}
