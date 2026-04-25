import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Inject,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { IStorageAdapter, STORAGE_ADAPTER } from '../storage/storage.interface';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { PipelineSchemasService } from './pipeline-schemas.service';
import { StateSchemaGeneratorService } from './state-schema-generator.service';
import { ChatSchemaGeneratorService } from './chat-schema-generator.service';
import { UploadSchemaGeneratorService } from './upload-schema-generator.service';
import {
  CreatePipelineSchemaDto,
  UpdatePipelineSchemaDto,
  PipelineSchemaResponseDto,
  PipelineSchemaWithCountDto,
  SchemasListResponseDto,
  GenerateStateSchemaDto,
  GenerateStateSchemaResponseDto,
  GenerateChatSchemaDto,
  GenerateChatSchemaResponseDto,
  GenerateUploadSchemaDto,
  GenerateUploadSchemaResponseDto,
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
  constructor(
    private readonly schemasService: PipelineSchemasService,
    private readonly stateSchemaGenerator: StateSchemaGeneratorService,
    private readonly chatSchemaGenerator: ChatSchemaGeneratorService,
    private readonly uploadSchemaGenerator: UploadSchemaGeneratorService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'List all schemas for a project with record counts' })
  @ApiParam({ name: 'projectId', type: 'string' })
  @ApiResponse({ status: 200, description: 'List of schemas', type: SchemasListResponseDto })
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<SchemasListResponseDto> {
    const schemas = await this.schemasService.getByProjectId(projectId, user.apiKeyProjectId);
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
    return this.schemasService.create(dto, user.id, user.role || 'user', user.apiKeyProjectId);
  }

  @Post('generate-state')
  @ApiOperation({
    summary: 'Generate a state schema with GET/POST pipelines',
    description:
      'Creates a schema optimized for @bffless/use-bff-state React hook with ' +
      'automatic GET and POST pipelines for state management.',
  })
  @ApiResponse({
    status: 201,
    description: 'State schema and pipelines created',
    type: GenerateStateSchemaResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Schema name already exists' })
  async generateStateSchema(
    @Body() dto: GenerateStateSchemaDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<GenerateStateSchemaResponseDto> {
    return this.stateSchemaGenerator.generateStateSchema(
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Post('generate-chat')
  @ApiOperation({
    summary: 'Generate a chat schema with AI-powered pipelines',
    description:
      'Creates conversations and messages schemas with ' +
      'automatic CRUD and AI chat pipelines for conversation management.',
  })
  @ApiResponse({
    status: 201,
    description: 'Chat schemas and pipelines created',
    type: GenerateChatSchemaResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Schema name already exists' })
  async generateChatSchema(
    @Body() dto: GenerateChatSchemaDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<GenerateChatSchemaResponseDto> {
    return this.chatSchemaGenerator.generateChatSchema(
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Post('generate-upload')
  @ApiOperation({
    summary: 'Generate an upload schema with POST/GET pipelines',
    description:
      'Creates a schema for file upload metadata with ' +
      'automatic POST (upload) and GET (serve) pipelines.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload schema and pipelines created',
    type: GenerateUploadSchemaResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 409, description: 'Schema name already exists' })
  async generateUploadSchema(
    @Body() dto: GenerateUploadSchemaDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<GenerateUploadSchemaResponseDto> {
    return this.uploadSchemaGenerator.generateUploadSchema(
      dto,
      user.id,
      user.role || 'user',
      user.apiKeyProjectId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a schema with record count' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'Schema details', type: PipelineSchemaWithCountDto })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineSchemaWithCountDto> {
    const schema = await this.schemasService.getByIdWithCount(id, user.apiKeyProjectId);
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
    return this.schemasService.update(id, dto, user.id, user.role || 'user', user.apiKeyProjectId);
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
    await this.schemasService.delete(id, user.id, user.role || 'user', user.apiKeyProjectId);
    return { success: true };
  }

  @Get('storage/preview')
  @ApiOperation({
    summary: 'Serve a file from storage by storage path (for admin previews)',
    description: 'Authenticated endpoint to serve uploaded files directly from storage.',
  })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 400, description: 'Invalid path' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async serveStorageFile(
    @Query('path') storagePath: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!storagePath || storagePath.includes('..')) {
      throw new BadRequestException('Invalid storage path');
    }

    try {
      const data = await this.storageAdapter.download(storagePath);

      // Determine content type from extension
      const ext = storagePath.split('.').pop()?.toLowerCase() || '';
      const mimeTypes: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        pdf: 'application/pdf', ico: 'image/x-icon',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', data.length);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).end(data);
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}
