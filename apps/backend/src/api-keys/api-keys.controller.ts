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
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import {
  CreateApiKeyDto,
  UpdateApiKeyDto,
  ListApiKeysQueryDto,
  CreateApiKeyResponseDto,
  GetApiKeyResponseDto,
  UpdateApiKeyResponseDto,
  DeleteApiKeyResponseDto,
  ListApiKeysResponseDto,
} from './api-keys.dto';

@ApiTags('API Keys')
@ApiBearerAuth()
@Controller('api/api-keys')
@UseGuards(SessionAuthGuard, RolesGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      'Creates a new API key for the authenticated user. The raw key is returned only once in the response - store it securely.',
  })
  @ApiResponse({
    status: 201,
    description: 'API key created successfully',
    type: CreateApiKeyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() createApiKeyDto: CreateApiKeyDto,
  ): Promise<CreateApiKeyResponseDto> {
    const { apiKey, rawKey } = await this.apiKeysService.create(user.id, createApiKeyDto);

    return {
      message: 'API key created successfully',
      data: apiKey,
      key: rawKey,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List API keys',
    description: 'Returns a paginated list of API keys for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of API keys',
    type: ListApiKeysResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListApiKeysQueryDto,
  ): Promise<ListApiKeysResponseDto> {
    return this.apiKeysService.findAll(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get API key details',
    description: 'Returns details of a specific API key.',
  })
  @ApiParam({
    name: 'id',
    description: 'API key ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'API key details',
    type: GetApiKeyResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your API key' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async findOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GetApiKeyResponseDto> {
    const apiKey = await this.apiKeysService.findOne(id, user.id);
    return { data: apiKey };
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update API key',
    description: 'Updates the name, allowed repositories, or expiration of an API key.',
  })
  @ApiParam({
    name: 'id',
    description: 'API key ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'API key updated successfully',
    type: UpdateApiKeyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your API key' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateApiKeyDto: UpdateApiKeyDto,
  ): Promise<UpdateApiKeyResponseDto> {
    const apiKey = await this.apiKeysService.update(id, user.id, updateApiKeyDto);
    return {
      message: 'API key updated successfully',
      data: apiKey,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke API key',
    description: 'Permanently revokes an API key. This action cannot be undone.',
  })
  @ApiParam({
    name: 'id',
    description: 'API key ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'API key revoked successfully',
    type: DeleteApiKeyResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your API key' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeleteApiKeyResponseDto> {
    await this.apiKeysService.remove(id, user.id);
    return {
      message: 'API key revoked successfully',
    };
  }
}
