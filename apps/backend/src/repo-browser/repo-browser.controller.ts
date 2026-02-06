import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { RepoBrowserService } from './repo-browser.service';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import {
  GetFileTreeResponseDto,
  GetRepositoryRefsResponseDto,
  RepositoryRefsQueryDto,
  GetDeploymentsQueryDto,
  GetDeploymentsResponseDto,
  GetRepositoryStatsResponseDto,
  GetAliasesResponseDto,
  GetAliasesQueryDto,
  CreateAliasRequestDto,
  UpdateAliasRequestDto,
  AliasCreatedResponseDto,
  GetCommitDetailsResponseDto,
} from './repo-browser.dto';

@ApiTags('Repository Browser')
@Controller('api/repo')
export class RepoBrowserController {
  constructor(private readonly repoBrowserService: RepoBrowserService) {}

  @Get(':owner/:repo/:ref/files')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get file tree for a deployment by commit SHA or alias',
    description:
      'Returns all files for a specific deployment. Accepts both commit SHAs and aliases (e.g., main, production). Public repos are accessible without auth.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({
    name: 'ref',
    description: 'Git commit SHA (full or partial) or alias (e.g., main, production)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File tree retrieved successfully',
    type: GetFileTreeResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Deployment not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to access this deployment',
  })
  async getFileTree(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('ref') ref: string,
    @CurrentUser() user?: CurrentUserData,
  ): Promise<GetFileTreeResponseDto> {
    return this.repoBrowserService.getFileTree(owner, repo, ref, user?.id || null);
  }

  @Get(':owner/:repo/refs')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get repository refs (aliases, branches, recent commits)',
    description:
      'Returns all available refs for repository navigation. Supports cursor-based pagination for commits.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repository refs retrieved successfully',
    type: GetRepositoryRefsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to access this repository',
  })
  async getRepositoryRefs(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: RepositoryRefsQueryDto,
  ): Promise<GetRepositoryRefsResponseDto> {
    return this.repoBrowserService.getRepositoryRefs(owner, repo, query);
  }

  @Get(':owner/:repo/deployments')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get deployments list with pagination and filtering',
    description:
      'Returns all deployments for a repository with pagination, filtering by branch, and sorting options. Public repos are accessible without auth.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Deployments list retrieved successfully',
    type: GetDeploymentsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to access this repository',
  })
  async getDeployments(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GetDeploymentsQueryDto,
    @CurrentUser() user?: CurrentUserData,
  ): Promise<GetDeploymentsResponseDto> {
    return this.repoBrowserService.getDeployments(owner, repo, query, user?.id || null);
  }

  @Get(':owner/:repo/stats')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get repository statistics',
    description:
      'Returns statistics for a repository including total deployments, storage used, branch count, and alias count. Public repos are accessible without auth.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repository statistics retrieved successfully',
    type: GetRepositoryStatsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to access this repository',
  })
  async getRepositoryStats(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @CurrentUser() user?: CurrentUserData,
  ): Promise<GetRepositoryStatsResponseDto> {
    return this.repoBrowserService.getRepositoryStats(owner, repo, user?.id || null);
  }

  // Alias Management Endpoints (Phase 2J)

  @Get(':owner/:repo/aliases')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get all aliases for a repository',
    description:
      'Returns all aliases for a repository with detailed information including commit SHA, branch, and timestamps. Public repos are accessible without auth.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Aliases retrieved successfully',
    type: GetAliasesResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to access this repository',
  })
  async getAliases(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GetAliasesQueryDto,
    // @CurrentUser() user?: CurrentUserData,
  ): Promise<GetAliasesResponseDto> {
    // console.log('todo handle user permissions', user);
    // @TODO: this needs permission check for public repos
    // currently permissions are setup on the upload for a deployment
    // this needs to be migrated to a repo level permission
    // that will require a new table to store the repo config (users, settings, etc)
    return this.repoBrowserService.getAliases(owner, repo, query.includeAutoPreview ?? false);
  }

  @Post(':owner/:repo/aliases')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Create alias for a repository',
    description:
      'Creates a new alias pointing to a specific commit SHA. Requires authentication and authorization for the repository.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Alias created successfully',
    type: AliasCreatedResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid alias name or commit SHA format',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Commit SHA not found in repository',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Alias name already exists',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to create alias for this repository',
  })
  async createAlias(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() dto: CreateAliasRequestDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasCreatedResponseDto> {
    return this.repoBrowserService.createRepositoryAlias(
      owner,
      repo,
      dto,
      user.id,
      user.role || 'user',
    );
  }

  @Patch(':owner/:repo/aliases/:aliasName')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Update alias to point to different commit SHA',
    description:
      'Updates an existing alias to point to a new commit SHA. Requires authentication and authorization for the repository.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({ name: 'aliasName', description: 'Alias name to update', example: 'production' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alias updated successfully',
    type: AliasCreatedResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid commit SHA format',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Alias or commit SHA not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to update alias for this repository',
  })
  async updateAlias(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('aliasName') aliasName: string,
    @Body() dto: UpdateAliasRequestDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<AliasCreatedResponseDto> {
    return this.repoBrowserService.updateRepositoryAlias(
      owner,
      repo,
      aliasName,
      dto,
      user.id,
      user.role || 'user',
    );
  }

  @Delete(':owner/:repo/aliases/:aliasName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Delete an alias',
    description:
      'Deletes an alias from the repository. Requires authentication and authorization for the repository.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({ name: 'aliasName', description: 'Alias name to delete', example: 'staging' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Alias deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Alias not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Not authorized to delete alias for this repository',
  })
  async deleteAlias(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('aliasName') aliasName: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<void> {
    return this.repoBrowserService.deleteRepositoryAlias(
      owner,
      repo,
      aliasName,
      user.id,
      user.role || 'user',
    );
  }

  @Get(':owner/:repo/:commitSha/details')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get commit and deployment details',
    description:
      'Returns detailed information about a specific commit/deployment including commit metadata, deployment stats, and aliases pointing to this commit. Public repos are accessible without auth.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiParam({ name: 'commitSha', description: 'Commit SHA or alias' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commit details retrieved successfully',
    type: GetCommitDetailsResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Commit not found',
  })
  async getCommitDetails(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('commitSha') commitSha: string,
    @CurrentUser() user: CurrentUserData | null,
  ): Promise<GetCommitDetailsResponseDto> {
    return this.repoBrowserService.getCommitDetails(owner, repo, commitSha, user?.id || null);
  }
}
