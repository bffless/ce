import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Res,
  ParseIntPipe,
  DefaultValuePipe,
  Body,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { PipelineDataService } from './pipeline-data.service';
import { PaginatedDataResponseDto, PipelineDataResponseDto, CreatePipelineDataDto, UpdatePipelineDataDto } from './dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Controller for pipeline data records.
 * Provides browsing, deletion, and export of data stored by pipeline handlers.
 */
@ApiTags('Pipeline Data')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('api/pipeline-schemas/:schemaId/data')
@UseGuards(ApiKeyGuard)
export class PipelineDataController {
  constructor(private readonly dataService: PipelineDataService) {}

  @Get()
  @ApiOperation({ summary: 'List data records with pagination' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated data records', type: PaginatedDataResponseDto })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async listRecords(
    @Param('schemaId', ParseUUIDPipe) schemaId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PaginatedDataResponseDto> {
    // Limit page size to prevent excessive queries
    const limitedPageSize = Math.min(pageSize, 100);
    return this.dataService.getBySchemaId(schemaId, page, limitedPageSize, user.id, user.role || 'user');
  }

  @Post()
  @ApiOperation({ summary: 'Create a new data record' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiResponse({ status: 201, description: 'Record created', type: PipelineDataResponseDto })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async createRecord(
    @Param('schemaId', ParseUUIDPipe) schemaId: string,
    @Body() dto: CreatePipelineDataDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineDataResponseDto> {
    return this.dataService.createWithAccess(schemaId, dto.data, user.id, user.role || 'user');
  }

  // Static routes MUST come before dynamic :recordId routes
  @Get('export')
  @ApiOperation({ summary: 'Export all data records' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv'], example: 'json' })
  @ApiResponse({ status: 200, description: 'Exported data' })
  @ApiResponse({ status: 404, description: 'Schema not found' })
  async exportRecords(
    @Param('schemaId', ParseUUIDPipe) schemaId: string,
    @Query('format') format: 'json' | 'csv' = 'json',
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.dataService.exportBySchemaId(schemaId, format, user.id, user.role || 'user');

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const extension = format === 'csv' ? 'csv' : 'json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="data-export.${extension}"`);
    res.send(data);
  }

  @Delete('bulk')
  @ApiOperation({ summary: 'Delete multiple data records' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Records deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async deleteRecords(
    @Body() body: { ids: string[] },
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean; deleted: number }> {
    const deleted = await this.dataService.deleteMany(body.ids, user.id, user.role || 'user');
    return { success: true, deleted };
  }

  // Dynamic :recordId routes come after static routes
  @Get(':recordId')
  @ApiOperation({ summary: 'Get a single data record' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiParam({ name: 'recordId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Data record', type: PipelineDataResponseDto })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getRecord(
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineDataResponseDto> {
    return this.dataService.getByIdWithAccess(recordId, user.id, user.role || 'user');
  }

  @Put(':recordId')
  @ApiOperation({ summary: 'Update a data record' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiParam({ name: 'recordId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Record updated', type: PipelineDataResponseDto })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async updateRecord(
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdatePipelineDataDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<PipelineDataResponseDto> {
    return this.dataService.update(recordId, dto.data, user.id, user.role || 'user');
  }

  @Delete(':recordId')
  @ApiOperation({ summary: 'Delete a single data record' })
  @ApiParam({ name: 'schemaId', type: 'string' })
  @ApiParam({ name: 'recordId', type: 'string' })
  @ApiResponse({ status: 200, description: 'Record deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async deleteRecord(
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<{ success: boolean }> {
    await this.dataService.delete(recordId, user.id, user.role || 'user');
    return { success: true };
  }
}
