import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
  Headers,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiHeader,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { AssetsService } from './assets.service';
import {
  UploadAssetDto,
  UpdateAssetDto,
  ListAssetsQueryDto,
  BatchDeleteDto,
  UploadAssetResponseDto,
  BatchUploadResponseDto,
  GetAssetResponseDto,
  UpdateAssetResponseDto,
  DeleteAssetResponseDto,
  BatchDeleteResponseDto,
  ListAssetsResponseDto,
  GetAssetUrlResponseDto,
} from './assets.dto';

@ApiTags('Assets')
@ApiSecurity('api-key')
@ApiBearerAuth()
@Controller('api/assets')
@UseGuards(ApiKeyGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Upload a single asset
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a single asset' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        repository: { type: 'string' },
        branch: { type: 'string' },
        commitSha: { type: 'string' },
        workflowName: { type: 'string' },
        workflowRunId: { type: 'string' },
        workflowRunNumber: { type: 'number' },
        deploymentId: { type: 'string' },
        isPublic: { type: 'boolean' },
        publicPath: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Asset uploaded successfully',
    type: UploadAssetResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file or input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not authorized for this repository' })
  @ApiHeader({
    name: 'x-github-repository',
    required: false,
    description: 'GitHub repository (owner/repo)',
  })
  @ApiHeader({ name: 'x-github-branch', required: false, description: 'Git branch name' })
  @ApiHeader({ name: 'x-github-commit', required: false, description: 'Git commit SHA' })
  @ApiHeader({
    name: 'x-github-workflow',
    required: false,
    description: 'GitHub Actions workflow name',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAssetDto,
    @CurrentUser() user: CurrentUserData,
    @Headers('x-github-repository') headerRepository?: string,
    @Headers('x-github-branch') headerBranch?: string,
    @Headers('x-github-commit') headerCommit?: string,
    @Headers('x-github-workflow') headerWorkflow?: string,
  ): Promise<UploadAssetResponseDto> {
    // Merge GitHub context from headers if not provided in body
    const uploadDto: UploadAssetDto = {
      ...dto,
      repository: dto.repository || headerRepository,
      branch: dto.branch || headerBranch,
      commitSha: dto.commitSha || headerCommit,
      workflowName: dto.workflowName || headerWorkflow,
    };

    const asset = await this.assetsService.upload(
      file,
      uploadDto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );

    return {
      message: 'Asset uploaded successfully',
      data: asset,
    };
  }

  /**
   * Upload multiple assets (batch upload)
   */
  @Post('batch-upload')
  @UseInterceptors(FilesInterceptor('files', 50)) // Max 50 files
  @ApiOperation({ summary: 'Upload multiple assets' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        repository: { type: 'string' },
        branch: { type: 'string' },
        commitSha: { type: 'string' },
        workflowName: { type: 'string' },
        deploymentId: { type: 'string' },
        isPublic: { type: 'boolean' },
      },
      required: ['files'],
    },
  })
  @ApiResponse({ status: 201, description: 'Assets uploaded', type: BatchUploadResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid files or input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiHeader({
    name: 'x-github-repository',
    required: false,
    description: 'GitHub repository (owner/repo)',
  })
  @ApiHeader({ name: 'x-github-branch', required: false, description: 'Git branch name' })
  @ApiHeader({ name: 'x-github-commit', required: false, description: 'Git commit SHA' })
  async batchUpload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadAssetDto,
    @CurrentUser() user: CurrentUserData,
    @Headers('x-github-repository') headerRepository?: string,
    @Headers('x-github-branch') headerBranch?: string,
    @Headers('x-github-commit') headerCommit?: string,
  ): Promise<BatchUploadResponseDto> {
    // Merge GitHub context from headers
    const uploadDto: UploadAssetDto = {
      ...dto,
      repository: dto.repository || headerRepository,
      branch: dto.branch || headerBranch,
      commitSha: dto.commitSha || headerCommit,
    };

    const result = await this.assetsService.batchUpload(
      files,
      uploadDto,
      user.id,
      user.role,
      user.apiKeyProjectId,
    );

    return {
      message: `${result.assets.length} assets uploaded successfully`,
      data: result.assets,
      uploadedCount: result.assets.length,
      failed: result.failed.length > 0 ? result.failed : undefined,
    };
  }

  /**
   * List assets with filtering and pagination
   */
  @Get()
  @ApiOperation({ summary: 'List assets with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'List of assets', type: ListAssetsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListAssetsQueryDto,
  ): Promise<ListAssetsResponseDto> {
    return this.assetsService.findAll(query, user.id, user.role || 'user', user.apiKeyProjectId);
  }

  /**
   * Get asset details by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get asset details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Asset details', type: GetAssetResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async findOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GetAssetResponseDto> {
    const asset = await this.assetsService.findById(
      id,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );

    return { data: asset };
  }

  /**
   * Download asset
   */
  @Get(':id/download')
  @ApiOperation({ summary: 'Download asset file' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'File download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async download(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName, mimeType } = await this.assetsService.download(
      id,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }

  /**
   * Get presigned/direct URL for asset
   */
  @Get(':id/url')
  @ApiOperation({ summary: 'Get URL to access asset' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Asset URL', type: GetAssetUrlResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async getUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expiresIn') expiresIn?: number,
  ): Promise<GetAssetUrlResponseDto> {
    const result = await this.assetsService.getUrl(
      id,
      user.id,
      user.role || 'user',
      expiresIn,
      user.apiKeyProjectId,
    );

    return result;
  }

  /**
   * Update asset metadata
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update asset metadata' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Asset updated', type: UpdateAssetResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
  ): Promise<UpdateAssetResponseDto> {
    const asset = await this.assetsService.update(
      id,
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );

    return {
      message: 'Asset updated successfully',
      data: asset,
    };
  }

  /**
   * Delete asset
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete asset' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Asset deleted', type: DeleteAssetResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeleteAssetResponseDto> {
    await this.assetsService.delete(id, user.id, user.role || 'user', user.apiKeyProjectId);

    return { message: 'Asset deleted successfully' };
  }

  /**
   * Batch delete assets
   */
  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete multiple assets' })
  @ApiResponse({ status: 200, description: 'Assets deleted', type: BatchDeleteResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async batchRemove(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: BatchDeleteDto,
  ): Promise<BatchDeleteResponseDto> {
    const deletedCount = await this.assetsService.batchDelete(
      dto.ids,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );

    return {
      message: `${deletedCount} assets deleted successfully`,
      deletedCount,
    };
  }

  /**
   * Delete all assets for a repository (optionally filtered by commit)
   */
  @Delete('repository/:repository')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete all assets for a repository',
    description:
      'Delete all assets for a repository. Optionally filter by commitSha to only delete assets for a specific commit.',
  })
  @ApiParam({ name: 'repository', description: 'Repository name (e.g., owner/repo)' })
  @ApiResponse({ status: 200, description: 'Assets deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not authorized for this repository' })
  async deleteRepositoryAssets(
    @CurrentUser() user: CurrentUserData,
    @Param('repository') repository: string,
    @Query('commitSha') commitSha?: string,
  ): Promise<{ message: string; deletedCount: number }> {
    const decodedRepo = decodeURIComponent(repository);
    const deletedCount = await this.assetsService.deleteByRepository(
      decodedRepo,
      user.id,
      user.role || 'user',
      commitSha,
      user.apiKeyProjectId,
    );

    const scope = commitSha
      ? `repository ${decodedRepo} commit ${commitSha}`
      : `repository ${decodedRepo}`;

    return {
      message: `${deletedCount} assets deleted for ${scope}`,
      deletedCount,
    };
  }
}
