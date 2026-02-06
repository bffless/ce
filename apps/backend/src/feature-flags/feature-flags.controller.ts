import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard, RolesGuard, Roles } from '../auth';
import { FeatureFlagsService, ResolvedFlag } from './feature-flags.service';
import { isValidFlagKey } from './feature-flags.definitions';
import {
  UpdateFeatureFlagDto,
  FeatureFlagResponseDto,
  AllFlagsResponseDto,
  FeatureFlagSourcesDto,
  BatchUpdateFlagsDto,
} from './dto/feature-flags.dto';

@ApiTags('Feature Flags')
@Controller('api/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  // ==========================================================================
  // Public endpoints (authenticated users can read flags)
  // ==========================================================================

  @Get('client')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get UI-exposed feature flags (allowlisted only)' })
  @ApiResponse({
    status: 200,
    description: 'Client-safe feature flags as key-value map',
  })
  async getClientFlags(): Promise<Record<string, boolean | string | number | object>> {
    return this.featureFlagsService.getClientFlags();
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get all feature flags with resolved values' })
  @ApiResponse({
    status: 200,
    description: 'All feature flags',
    type: AllFlagsResponseDto,
  })
  async getAllFlags(): Promise<AllFlagsResponseDto> {
    const flags = await this.featureFlagsService.getAllFlags();
    return { flags: this.toResponseDtos(flags) };
  }

  @Get('grouped')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get all feature flags grouped by category' })
  @ApiResponse({
    status: 200,
    description: 'Feature flags grouped by category',
  })
  async getFlagsByCategory(): Promise<Record<string, FeatureFlagResponseDto[]>> {
    const grouped = await this.featureFlagsService.getFlagsByCategory();
    const result: Record<string, FeatureFlagResponseDto[]> = {};

    for (const [category, flags] of Object.entries(grouped)) {
      result[category] = this.toResponseDtos(flags);
    }

    return result;
  }

  @Get(':key')
  @UseGuards(SessionAuthGuard)
  @ApiOperation({ summary: 'Get a single feature flag' })
  @ApiParam({ name: 'key', description: 'Feature flag key', example: 'ENABLE_CUSTOM_DOMAINS' })
  @ApiResponse({
    status: 200,
    description: 'Feature flag details',
    type: FeatureFlagResponseDto,
  })
  async getFlag(@Param('key') key: string): Promise<FeatureFlagResponseDto> {
    this.validateFlagKey(key);
    const flag = await this.featureFlagsService.resolve(key);
    return this.toResponseDto(flag);
  }

  @Get(':key/sources')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Get all source values for a feature flag (admin only)' })
  @ApiParam({ name: 'key', description: 'Feature flag key' })
  @ApiResponse({
    status: 200,
    description: 'Flag values from all sources',
    type: FeatureFlagSourcesDto,
  })
  async getFlagSources(@Param('key') key: string): Promise<FeatureFlagSourcesDto> {
    this.validateFlagKey(key);
    return this.featureFlagsService.getSources(key);
  }

  // ==========================================================================
  // Admin endpoints (only admins can modify flags)
  // ==========================================================================

  @Put(':key')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Set a feature flag value (creates database override)' })
  @ApiParam({ name: 'key', description: 'Feature flag key' })
  @ApiResponse({
    status: 200,
    description: 'Updated feature flag',
    type: FeatureFlagResponseDto,
  })
  async setFlag(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagResponseDto> {
    this.validateFlagKey(key);

    await this.featureFlagsService.setFlag(key, dto.value, dto.enabled ?? true);
    const flag = await this.featureFlagsService.resolve(key);
    return this.toResponseDto(flag);
  }

  @Put()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Set multiple feature flags at once' })
  @ApiResponse({
    status: 200,
    description: 'Updated feature flags',
    type: AllFlagsResponseDto,
  })
  async setFlags(@Body() dto: BatchUpdateFlagsDto): Promise<AllFlagsResponseDto> {
    // Validate all keys first
    for (const flag of dto.flags) {
      this.validateFlagKey(flag.key);
    }

    await this.featureFlagsService.setFlags(
      dto.flags.map((f) => ({
        key: f.key,
        value: f.value,
        enabled: f.enabled,
      })),
    );

    const flags = await this.featureFlagsService.getAllFlags();
    return { flags: this.toResponseDtos(flags) };
  }

  @Delete(':key')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a database override (reverts to file/env/default)' })
  @ApiParam({ name: 'key', description: 'Feature flag key' })
  @ApiResponse({ status: 204, description: 'Override deleted' })
  async deleteFlag(@Param('key') key: string): Promise<void> {
    this.validateFlagKey(key);
    await this.featureFlagsService.deleteFlag(key);
  }

  @Post('refresh')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Refresh all caches (reload file and database)' })
  @ApiResponse({ status: 204, description: 'Caches refreshed' })
  async refreshCache(): Promise<void> {
    await this.featureFlagsService.invalidateCache();
  }

  @Get('admin/overrides')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Get all database overrides (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'List of database overrides',
  })
  async getDatabaseOverrides() {
    return this.featureFlagsService.getDatabaseOverrides();
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private validateFlagKey(key: string): void {
    if (!isValidFlagKey(key)) {
      throw new BadRequestException(`Unknown feature flag: ${key}`);
    }
  }

  private toResponseDto(flag: ResolvedFlag): FeatureFlagResponseDto {
    return {
      key: flag.key,
      value: flag.value,
      type: flag.type,
      source: flag.source,
      description: flag.description,
      category: flag.category,
    };
  }

  private toResponseDtos(flags: ResolvedFlag[]): FeatureFlagResponseDto[] {
    return flags.map((f) => this.toResponseDto(f));
  }
}
