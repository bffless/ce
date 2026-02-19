import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OnboardingRulesService } from './onboarding-rules.service';
import {
  CreateOnboardingRuleDto,
  UpdateOnboardingRuleDto,
  OnboardingRuleResponseDto,
  OnboardingRuleExecutionResponseDto,
} from './dto';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('Onboarding Rules')
@ApiBearerAuth()
@Controller('api/onboarding-rules')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class OnboardingRulesController {
  constructor(private readonly onboardingRulesService: OnboardingRulesService) {}

  /**
   * Get all onboarding rules
   */
  @Get()
  @ApiOperation({ summary: 'List all onboarding rules' })
  @ApiResponse({
    status: 200,
    description: 'List of onboarding rules',
    type: [OnboardingRuleResponseDto],
  })
  async getAllRules(): Promise<{ rules: OnboardingRuleResponseDto[] }> {
    const rules = await this.onboardingRulesService.getAllRules();
    return { rules: rules as OnboardingRuleResponseDto[] };
  }

  /**
   * Get a specific onboarding rule
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a specific onboarding rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Onboarding rule ID' })
  @ApiResponse({
    status: 200,
    description: 'Onboarding rule details',
    type: OnboardingRuleResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRule(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingRuleResponseDto> {
    const rule = await this.onboardingRulesService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException(`Onboarding rule ${id} not found`);
    }
    return rule as OnboardingRuleResponseDto;
  }

  /**
   * Create a new onboarding rule
   */
  @Post()
  @ApiOperation({ summary: 'Create a new onboarding rule' })
  @ApiResponse({
    status: 201,
    description: 'Created onboarding rule',
    type: OnboardingRuleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized (admin only)' })
  async createRule(
    @Body() dto: CreateOnboardingRuleDto,
    @CurrentUser() user: CurrentUserData,
  ): Promise<OnboardingRuleResponseDto> {
    const rule = await this.onboardingRulesService.create(dto, user.id);
    return rule as OnboardingRuleResponseDto;
  }

  /**
   * Update an onboarding rule
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update an onboarding rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Onboarding rule ID' })
  @ApiResponse({
    status: 200,
    description: 'Updated onboarding rule',
    type: OnboardingRuleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized (admin only)' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnboardingRuleDto,
  ): Promise<OnboardingRuleResponseDto> {
    const rule = await this.onboardingRulesService.update(id, dto);
    return rule as OnboardingRuleResponseDto;
  }

  /**
   * Delete an onboarding rule
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an onboarding rule' })
  @ApiParam({ name: 'id', type: 'string', description: 'Onboarding rule ID' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @ApiResponse({ status: 403, description: 'Not authorized (admin only)' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    await this.onboardingRulesService.delete(id);
    return { success: true };
  }

  /**
   * Get recent rule execution audit log
   */
  @Get('executions/recent')
  @ApiOperation({ summary: 'Get recent onboarding rule executions' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Maximum number of executions to return (default: 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Recent rule executions',
    type: [OnboardingRuleExecutionResponseDto],
  })
  async getRecentExecutions(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{ executions: OnboardingRuleExecutionResponseDto[] }> {
    const executions = await this.onboardingRulesService.getRecentExecutions(
      Math.min(limit, 100),
    );
    return { executions: executions as OnboardingRuleExecutionResponseDto[] };
  }
}
