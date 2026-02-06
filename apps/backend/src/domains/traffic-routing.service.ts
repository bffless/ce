import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { domainMappings, domainTrafficWeights, deploymentAliases } from '../db/schema';
import { SetTrafficWeightsDto, TrafficWeightItemDto } from './dto/traffic-weight.dto';
import { TrafficRulesService } from './traffic-rules.service';

export interface VariantSelectionResult {
  selectedAlias: string;
  isNewSelection: boolean;
  stickySessionDuration: number;
}

@Injectable()
export class TrafficRoutingService {
  private readonly logger = new Logger(TrafficRoutingService.name);

  // Cookie name for variant tracking
  static readonly VARIANT_COOKIE_NAME = '__bffless_variant';

  constructor(private readonly trafficRulesService: TrafficRulesService) {}

  /**
   * Get traffic configuration for a domain
   */
  async getTrafficConfig(domainId: string, _userId: string) {
    // Get domain
    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainId))
      .limit(1);

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Get weights
    const weights = await db
      .select()
      .from(domainTrafficWeights)
      .where(eq(domainTrafficWeights.domainId, domainId));

    // Sort by weight descending
    weights.sort((a, b) => b.weight - a.weight);

    return {
      weights,
      stickySessionsEnabled: domain.stickySessionsEnabled,
      stickySessionDuration: domain.stickySessionDuration,
    };
  }

  /**
   * Set traffic weights for a domain
   * Replaces all existing weights
   */
  async setTrafficWeights(domainId: string, dto: SetTrafficWeightsDto, userId: string) {
    // 1. Validate domain exists
    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainId))
      .limit(1);

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Redirect domains can't have traffic weights
    if (domain.domainType === 'redirect') {
      throw new BadRequestException('Traffic weights are not supported for redirect domains');
    }

    // Non-redirect domains require a projectId
    if (!domain.projectId) {
      throw new BadRequestException('Domain has no associated project');
    }

    // 2. Validate weights sum to 100
    this.validateWeights(dto.weights);

    // 3. Validate all aliases exist for the project
    await this.validateAliases(
      domain.projectId,
      dto.weights.map((w) => w.alias),
    );

    // 4. Delete existing weights
    await db.delete(domainTrafficWeights).where(eq(domainTrafficWeights.domainId, domainId));

    // 5. Insert new weights
    if (dto.weights.length > 0) {
      await db.insert(domainTrafficWeights).values(
        dto.weights.map((w) => ({
          domainId,
          alias: w.alias,
          weight: w.weight,
        })),
      );
    }

    // 6. Update sticky session settings if provided
    if (dto.stickySessionsEnabled !== undefined || dto.stickySessionDuration !== undefined) {
      await db
        .update(domainMappings)
        .set({
          stickySessionsEnabled: dto.stickySessionsEnabled ?? domain.stickySessionsEnabled,
          stickySessionDuration: dto.stickySessionDuration ?? domain.stickySessionDuration,
          updatedAt: new Date(),
        })
        .where(eq(domainMappings.id, domainId));
    }

    // 7. Return updated config
    return this.getTrafficConfig(domainId, userId);
  }

  /**
   * Clear all traffic weights (return to single alias mode)
   */
  async clearTrafficWeights(domainId: string, _userId: string) {
    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainId))
      .limit(1);

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Delete all weights
    await db.delete(domainTrafficWeights).where(eq(domainTrafficWeights.domainId, domainId));

    return { success: true };
  }

  /**
   * Select a variant for a request based on traffic weights
   * Returns the selected alias and whether a new cookie should be set
   */
  async selectVariant(
    domainName: string,
    existingVariantCookie: string | undefined,
    queryParams?: Record<string, string>,
    cookies?: Record<string, string>,
  ): Promise<VariantSelectionResult | null> {
    // Find domain by name (also check www/non-www alternate for redirect-to-www/root cases)
    const alternate = domainName.startsWith('www.') ? domainName.slice(4) : `www.${domainName}`;

    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(or(eq(domainMappings.domain, domainName), eq(domainMappings.domain, alternate)))
      .limit(1);

    if (!domain) {
      return null;
    }

    // Get traffic weights for this domain
    const weights = await db
      .select()
      .from(domainTrafficWeights)
      .where(eq(domainTrafficWeights.domainId, domain.id));

    // If no weights configured or only one, no multivariant routing needed
    if (weights.length <= 1) {
      return null;
    }

    // Evaluate traffic rules — rules override sticky sessions and weighted selection.
    // Rule aliases don't need to be in the weights list — they can route to any
    // valid deployment alias (e.g., a share link forcing alias "netflix" while
    // normal traffic splits between "skills" and "production").
    if (queryParams || cookies) {
      const ruleMatch = await this.trafficRulesService.evaluateRules(
        domain.id,
        queryParams,
        cookies,
      );
      if (ruleMatch) {
        return {
          selectedAlias: ruleMatch,
          isNewSelection: true,
          stickySessionDuration: domain.stickySessionDuration,
        };
      }
    }

    // Check if existing cookie has a valid variant.
    // Accept the cookie if the alias is in the weights list OR if it's referenced
    // by an active traffic rule (a prior rule match set this cookie, and subsequent
    // requests like asset loads need to stay on the same alias).
    if (existingVariantCookie && domain.stickySessionsEnabled) {
      const inWeights = weights.some((w) => w.alias === existingVariantCookie);
      const inRules = !inWeights
        ? await this.trafficRulesService.isRuleAlias(domain.id, existingVariantCookie)
        : false;

      if (inWeights || inRules) {
        return {
          selectedAlias: existingVariantCookie,
          isNewSelection: false,
          stickySessionDuration: domain.stickySessionDuration,
        };
      }
    }

    // Select a new variant based on weights
    const selectedAlias = this.selectWeightedRandom(weights);

    return {
      selectedAlias,
      isNewSelection: true,
      stickySessionDuration: domain.stickySessionDuration,
    };
  }

  /**
   * Select an alias based on weighted random selection
   */
  private selectWeightedRandom(weights: { alias: string; weight: number }[]): string {
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;

    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) {
        return w.alias;
      }
    }

    // Fallback to last alias (should not happen)
    return weights[weights.length - 1].alias;
  }

  /**
   * Validate weights sum to 100%
   */
  validateWeights(weights: TrafficWeightItemDto[]): void {
    if (weights.length === 0) {
      return; // Empty is allowed (clears traffic splitting)
    }

    const total = weights.reduce((sum, w) => sum + w.weight, 0);
    if (total !== 100) {
      throw new BadRequestException(`Traffic weights must sum to 100%, got ${total}%`);
    }

    // Check for duplicate aliases
    const aliases = weights.map((w) => w.alias);
    const uniqueAliases = new Set(aliases);
    if (aliases.length !== uniqueAliases.size) {
      throw new BadRequestException('Duplicate aliases not allowed');
    }

    // Check all weights are non-negative
    if (weights.some((w) => w.weight < 0)) {
      throw new BadRequestException('Weights cannot be negative');
    }
  }

  /**
   * Validate all aliases exist for the project
   */
  private async validateAliases(projectId: string, aliases: string[]): Promise<void> {
    if (aliases.length === 0) return;

    // Get all deployment aliases for this project
    const projectAliases = await db
      .select({ alias: deploymentAliases.alias })
      .from(deploymentAliases)
      .where(eq(deploymentAliases.projectId, projectId));

    const existingAliases = new Set(projectAliases.map((d) => d.alias).filter(Boolean));

    const missingAliases = aliases.filter((a) => !existingAliases.has(a));
    if (missingAliases.length > 0) {
      throw new BadRequestException(
        `Aliases not found: ${missingAliases.join(', ')}. Available aliases: ${Array.from(existingAliases).join(', ')}`,
      );
    }
  }

  /**
   * Get available aliases for a project (via domain)
   */
  async getAvailableAliases(domainId: string): Promise<string[]> {
    // Get domain to find project
    const [domain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, domainId))
      .limit(1);

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }

    // Redirect domains have no aliases
    if (domain.domainType === 'redirect' || !domain.projectId) {
      return [];
    }

    const projectAliases = await db
      .select({ alias: deploymentAliases.alias })
      .from(deploymentAliases)
      .where(
        and(
          eq(deploymentAliases.projectId, domain.projectId),
          eq(deploymentAliases.isAutoPreview, false),
        ),
      );

    return projectAliases.map((d) => d.alias).filter((alias): alias is string => alias !== null);
  }
}
