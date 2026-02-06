import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GetMyRepositoriesResponseDto,
  GetRepositoryFeedQueryDto,
  GetRepositoryFeedResponseDto,
} from './projects.dto';

@ApiTags('Repositories')
@Controller('api/repositories')
export class RepositoriesController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('mine')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my repositories (sidebar)',
    description:
      'Returns repositories owned or shared with the current user. Used for sidebar navigation. ' +
      'Includes owned, direct permissions, and group permissions. Limited to 100 repos max.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'My repositories retrieved successfully',
    type: GetMyRepositoriesResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  async getMyRepositories(
    @CurrentUser('id') userId: string,
  ): Promise<GetMyRepositoriesResponseDto> {
    return this.projectsService.getMyRepositories(userId);
  }

  @Get('feed')
  @UseGuards(OptionalAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Get repository feed (activity or search results)',
    description:
      'Returns all accessible repositories sorted by activity. Supports search and pagination. ' +
      'Authenticated users see owned, shared, and public repos. Anonymous users see only public repos.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Repository feed retrieved successfully',
    type: GetRepositoryFeedResponseDto,
  })
  async getRepositoryFeed(
    @Query() query: GetRepositoryFeedQueryDto,
    @CurrentUser('id') userId?: string,
  ): Promise<GetRepositoryFeedResponseDto> {
    return this.projectsService.getRepositoryFeed(userId || null, query);
  }
}
