import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { DeploymentsService } from './deployments.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  CreateDeploymentDto,
  CreateDeploymentZipDto,
  ListDeploymentsQueryDto,
  CreateAliasDto,
  UpdateAliasDto,
  ListAliasesQueryDto,
  CreateDeploymentResponseDto,
  DeploymentDetailResponseDto,
  ListDeploymentsResponseDto,
  AliasResponseDto,
  ListAliasesResponseDto,
  UpdateAliasVisibilityDto,
  AliasVisibilityResponseDto,
  DeleteCommitResponseDto,
  DeleteCommitErrorDto,
} from './deployments.dto';
import { VisibilityService } from '../domains/visibility.service';
import { ProjectsService } from '../projects/projects.service';

@ApiTags('Deployments')
@Controller('api/deployments')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
    }),
  )
  @ApiOperation({ summary: 'Create a new deployment with files' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: CreateDeploymentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or no files provided' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async createDeployment(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: CreateDeploymentDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CreateDeploymentResponseDto> {
    return this.deploymentsService.createDeployment(files, dto, user.id, user.role);
  }

  @Post('zip')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 uploads per minute (stricter than global 100/min)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for zip file
    }),
  )
  @ApiOperation({ summary: 'Create a new deployment from a zip file' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: CreateDeploymentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or zip file' })
  @ApiResponse({ status: 403, description: 'Not authorized for this repository' })
  async createDeploymentFromZip(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDeploymentZipDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CreateDeploymentResponseDto> {
    return this.deploymentsService.createDeploymentFromZip(file, dto, user.id, user.role);
  }

  @Get()
  @ApiOperation({ summary: 'List deployments with filtering and pagination' })
  @ApiResponse({ status: 200, type: ListDeploymentsResponseDto })
  async listDeployments(
    @Query() query: ListDeploymentsQueryDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListDeploymentsResponseDto> {
    return this.deploymentsService.listDeployments(query, user.id, user.role || 'user');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deployment details including all files' })
  @ApiResponse({ status: 200, type: DeploymentDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to access this deployment' })
  async getDeployment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<DeploymentDetailResponseDto> {
    return this.deploymentsService.getDeployment(id, user.id, user.role || 'user');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete entire deployment and all its files' })
  @ApiResponse({ status: 204, description: 'Deployment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete this deployment' })
  async deleteDeployment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    return this.deploymentsService.deleteDeployment(id, user.id, user.role || 'user');
  }

  // Alias management endpoints

  @Post(':id/aliases')
  @ApiOperation({ summary: 'Create alias for a deployment' })
  @ApiResponse({ status: 201, type: AliasResponseDto })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to create alias' })
  async createAlias(
    @Param('id') deploymentId: string,
    @Body() dto: CreateAliasDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasResponseDto> {
    return this.deploymentsService.createAlias(deploymentId, dto, user.id, user.role || 'user');
  }

  @Delete('commit/:owner/:repo/:commitSha')
  @ApiOperation({ summary: 'Delete a commit and all its deployments' })
  @ApiResponse({
    status: 200,
    description: 'Commit deleted successfully',
    type: DeleteCommitResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete commit with active aliases',
    type: DeleteCommitErrorDto,
  })
  @ApiResponse({ status: 404, description: 'Commit not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete this commit' })
  async deleteCommit(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commitSha') commitSha: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<DeleteCommitResponseDto> {
    return this.deploymentsService.deleteCommit(owner, repo, commitSha, user.id, user.role);
  }
}

// Separate controller for alias management at /api/aliases
@ApiTags('Aliases')
@Controller('api/aliases')
@UseGuards(ApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class AliasesController {
  constructor(
    private readonly deploymentsService: DeploymentsService,
    private readonly visibilityService: VisibilityService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all aliases' })
  @ApiResponse({ status: 200, type: ListAliasesResponseDto })
  async listAliases(
    @Query() query: ListAliasesQueryDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<ListAliasesResponseDto> {
    return this.deploymentsService.listAliases(query, user.id, user.role || 'user');
  }

  @Put(':repository/:alias')
  @ApiOperation({ summary: 'Update alias to point to different commit SHA' })
  @ApiResponse({ status: 200, type: AliasResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to update alias' })
  async updateAlias(
    @Param('repository') repository: string,
    @Param('alias') alias: string,
    @Body() dto: UpdateAliasDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasResponseDto> {
    // Decode repository path (e.g., "owner%2Frepo" -> "owner/repo")
    const decodedRepo = decodeURIComponent(repository);
    return this.deploymentsService.updateAlias(
      decodedRepo,
      alias,
      dto,
      user.id,
      user.role || 'user',
    );
  }

  @Delete(':repository/:alias')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alias' })
  @ApiResponse({ status: 204, description: 'Alias deleted successfully' })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to delete alias' })
  async deleteAlias(
    @Param('repository') repository: string,
    @Param('alias') alias: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    const decodedRepo = decodeURIComponent(repository);
    return this.deploymentsService.deleteAlias(decodedRepo, alias, user.id, user.role || 'user');
  }

  // Phase B5: Alias Visibility Endpoints

  @Get(':projectId/:alias/visibility')
  @ApiOperation({ summary: 'Get resolved visibility for alias' })
  @ApiResponse({ status: 200, type: AliasVisibilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  async getAliasVisibility(
    @Param('projectId') projectId: string,
    @Param('alias') aliasName: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasVisibilityResponseDto> {
    const alias = await this.deploymentsService.getAlias(
      projectId,
      aliasName,
      user.id,
      user.role || 'user',
    );

    if (!alias) {
      throw new NotFoundException(`Alias not found: ${aliasName}`);
    }

    const project = await this.projectsService.getProjectById(projectId);
    const effectiveVisibility = await this.visibilityService.resolveAliasVisibility(
      projectId,
      aliasName,
    );

    return {
      projectId,
      alias: aliasName,
      effectiveVisibility: effectiveVisibility ? 'public' : 'private',
      source: alias.isPublic !== null ? 'alias' : 'project',
      aliasOverride: alias.isPublic,
      projectVisibility: project.isPublic,
    };
  }

  @Patch(':projectId/:alias/visibility')
  @ApiOperation({ summary: 'Update alias visibility' })
  @ApiResponse({ status: 200, type: AliasVisibilityResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to update alias visibility' })
  async updateAliasVisibility(
    @Param('projectId') projectId: string,
    @Param('alias') aliasName: string,
    @Body() dto: UpdateAliasVisibilityDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasVisibilityResponseDto> {
    const updated = await this.deploymentsService.updateAliasVisibility(
      projectId,
      aliasName,
      dto.isPublic ?? null,
      user.id,
      user.role || 'user',
    );

    const project = await this.projectsService.getProjectById(projectId);
    const effectiveVisibility = await this.visibilityService.resolveAliasVisibility(
      projectId,
      aliasName,
    );

    return {
      projectId,
      alias: aliasName,
      effectiveVisibility: effectiveVisibility ? 'public' : 'private',
      source: updated.isPublic !== null ? 'alias' : 'project',
      aliasOverride: updated.isPublic,
      projectVisibility: project.isPublic,
    };
  }
}
