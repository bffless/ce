import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';

/**
 * DTOs for the app-catalog admin HTTP surface (Task 11 of the app-catalog
 * spec). `PreflightRequestDto` is shared by both `preflight` and `install` —
 * the wizard re-submits the same target it just previewed.
 */

export class NewProjectDto {
  @ApiPropertyOptional({ description: 'Project owner (org/user segment)', example: 'acme' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  owner!: string;

  @ApiPropertyOptional({ description: 'Project name', example: 'site' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  name!: string;
}

/**
 * Install target: exactly one of `projectId` (install into an existing
 * project) or `newProject` (create one first) — enforced in
 * `AppCatalogService.toInstallTarget`, not here, since class-validator has no
 * built-in XOR-across-properties constraint that also reports a clean error.
 */
export class PreflightRequestDto {
  @ApiPropertyOptional({ description: 'Install into this existing project' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ type: NewProjectDto, description: 'Create a new project first' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewProjectDto)
  newProject?: NewProjectDto;
}

export class UpdateInstalledAppDto {
  @ApiPropertyOptional({
    description: 'Delete live rules absent from the new bundle (default: keep them)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  prune?: boolean;
}

export class AckManualStepDto {
  @ApiPropertyOptional({ description: 'The manual step id to mark acknowledged' })
  @IsString()
  stepId!: string;
}

/** `DELETE .../installed/:id?deleteData=true|false` — query strings arrive as text. */
export class UninstallQueryDto {
  @ApiPropertyOptional({
    description: 'Also delete data tables this install created (default: keep all data)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  deleteData?: boolean;
}
