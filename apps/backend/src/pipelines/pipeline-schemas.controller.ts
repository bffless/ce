import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { PipelineSchemasService } from './pipeline-schemas.service';
import {
  CreatePipelineSchemaDto,
  UpdatePipelineSchemaDto,
  PipelineSchemaResponseDto,
  PipelineSchemaWithCountDto,
  SchemasListResponseDto,
} from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for pipeline schemas.
 * Schemas define the structure of data stored by pipeline handlers.
 */
@ApiTags('Pipeline Schemas')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/pipeline-schemas')
@UseGuards(ApiKeyGuard)
export class PipelineSchemasController {
  constructor(private readonly schemasService: PipelineSchemasService) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List all schemas for a project with record counts' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of schemas', type: SchemasListResponseDto })
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<SchemasListResponseDto> {
    const schemas = await this.schemasService.getByProjectId(projectId);
    return { schemas };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new schema' })
  @ApiResponse({ status: 201, description: 'Created schema', type: PipelineSchemaResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Schema name already exists' })
  async create(
    @Body() dto: CreatePipelineSchemaDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineSchemaResponseDto> {
    return this.schemasService.create(dto, user.id, user.role || 'user');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a schema with record count' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Schema details', type: PipelineSchemaWithCountDto })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PipelineSchemaWithCountDto> {
    const schema = await this.schemasService.getByIdWithCount(id);
    if (!schema) {
      throw new NotFoundException(`Schema ${id} not found`);
    }
    return schema;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a schema' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Updated schema', type: PipelineSchemaResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  @ApiResponse({ status: 409, description: 'Schema name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineSchemaDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineSchemaResponseDto> {
    return this.schemasService.update(id, dto, user.id, user.role || 'user');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a schema (cascades to data records)' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Schema deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.schemasService.delete(id, user.id, user.role || 'user');
    return { success: true };
  }
}
