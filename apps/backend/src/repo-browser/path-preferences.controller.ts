import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PathPreferencesService, PathPreferenceResponse } from './path-preferences.service';
import { ProjectsService } from '../projects/projects.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { UpdatePathPreferenceDto, PathPreferenceResponseDto } from './path-preferences.dto';

@ApiTags('Path Preferences')
@Controller('api/repos/:owner/:repo/path-preferences')
@UseGuards(SessionAuthGuard)
@ApiBearerAuth()
export class PathPreferencesController {
  constructor(
    private readonly pathPreferencesService: PathPreferencesService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get path preference',
    description:
      'Get preference settings for a specific path within a repository. Returns default values if no preference exists.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiQuery({ name: 'filepath', description: 'Filepath within the repository', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Path preference retrieved successfully',
    type: PathPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing filepath query parameter',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication required',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Project not found',
  })
  async getOne(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('filepath') filepath: string,
  ): Promise<PathPreferenceResponse> {
    if (!filepath) {
      throw new BadRequestException('filepath query parameter is required');
    }

    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    return this.pathPreferencesService.getForPath(project.id, filepath);
  }

  @Put()
  @ApiOperation({
    summary: 'Update path preference',
    description:
      'Create or update preference settings for a specific path. This is a project-level setting shared by all users.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiQuery({ name: 'filepath', description: 'Filepath within the repository', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Path preference updated successfully',
    type: PathPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing filepath query parameter',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Project not found',
  })
  async upsert(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('filepath') filepath: string,
    @Body() dto: UpdatePathPreferenceDto,
  ): Promise<PathPreferenceResponse> {
    if (!filepath) {
      throw new BadRequestException('filepath query parameter is required');
    }

    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    return this.pathPreferencesService.upsert(project.id, filepath, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete path preference',
    description: 'Delete preference settings for a specific path, reverting to defaults.',
  })
  @ApiParam({ name: 'owner', description: 'Repository owner' })
  @ApiParam({ name: 'repo', description: 'Repository name' })
  @ApiQuery({ name: 'filepath', description: 'Filepath within the repository', required: true })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Path preference deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing filepath query parameter',
  })
  async delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('filepath') filepath: string,
  ): Promise<void> {
    if (!filepath) {
      throw new BadRequestException('filepath query parameter is required');
    }

    const project = await this.projectsService.getProjectByOwnerName(owner, repo);
    await this.pathPreferencesService.delete(project.id, filepath);
  }
}
