import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { domainRedirects, domainMappings } from '../db/schema';
import { CreateRedirectDto } from './dto/create-redirect.dto';
import { UpdateRedirectDto } from './dto/update-redirect.dto';
import { NginxConfigService } from './nginx-config.service';
import { NginxReloadService } from './nginx-reload.service';
import { SslCertificateService } from './ssl-certificate.service';

@Injectable()
export class RedirectsService {
  private readonly logger = new Logger(RedirectsService.name);

  constructor(
    private readonly nginxConfigService: NginxConfigService,
    private readonly nginxReloadService: NginxReloadService,
    private readonly sslCertificateService: SslCertificateService,
  ) {}

  async create(targetDomainId: string, dto: CreateRedirectDto, userId: string) {
    // 1. Verify target domain exists
    const [targetDomain] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.id, targetDomainId))
      .limit(1);

    if (!targetDomain) {
      throw new NotFoundException('Target domain not found');
    }

    // TODO: Check user permission on target domain's project

    // 2. Check source domain is not already used as a redirect
    const [existingRedirect] = await db
      .select()
      .from(domainRedirects)
      .where(eq(domainRedirects.sourceDomain, dto.sourceDomain))
      .limit(1);

    if (existingRedirect) {
      throw new ConflictException(
        `Domain "${dto.sourceDomain}" is already configured as a redirect`,
      );
    }

    // 3. Check source is not the same as target
    if (dto.sourceDomain === targetDomain.domain) {
      throw new ConflictException('Source domain cannot be the same as target domain');
    }

    // 4. Check source is not an existing domain mapping
    const [existingMapping] = await db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.domain, dto.sourceDomain))
      .limit(1);

    if (existingMapping) {
      throw new ConflictException(
        `Domain "${dto.sourceDomain}" is already configured as a domain mapping`,
      );
    }

    // 5. Create redirect record
    const [redirect] = await db
      .insert(domainRedirects)
      .values({
        sourceDomain: dto.sourceDomain,
        targetDomainId,
        redirectType: dto.redirectType,
        sslEnabled: dto.sslEnabled || false,
        createdBy: userId,
      })
      .returning();

    // 6. Generate and apply nginx config
    try {
      await this.generateNginxConfig(redirect.id, redirect, targetDomain.domain);
    } catch (error) {
      // Rollback: delete redirect from database
      this.logger.error(`Failed to generate nginx config, rolling back: ${error}`);
      await db.delete(domainRedirects).where(eq(domainRedirects.id, redirect.id));
      throw error;
    }

    this.logger.log(`Created redirect: ${redirect.sourceDomain} → ${targetDomain.domain}`);

    return {
      ...redirect,
      targetDomain: targetDomain.domain,
    };
  }

  async findByTargetDomain(targetDomainId: string, _userId: string) {
    // TODO: Check user permission

    const redirects = await db
      .select({
        redirect: domainRedirects,
        targetDomain: domainMappings.domain,
      })
      .from(domainRedirects)
      .innerJoin(domainMappings, eq(domainRedirects.targetDomainId, domainMappings.id))
      .where(eq(domainRedirects.targetDomainId, targetDomainId));

    return redirects.map((r) => ({
      ...r.redirect,
      targetDomain: r.targetDomain,
    }));
  }

  async findOne(id: string, _userId: string) {
    const [result] = await db
      .select({
        redirect: domainRedirects,
        targetDomain: domainMappings.domain,
      })
      .from(domainRedirects)
      .innerJoin(domainMappings, eq(domainRedirects.targetDomainId, domainMappings.id))
      .where(eq(domainRedirects.id, id))
      .limit(1);

    if (!result) {
      throw new NotFoundException(`Redirect with ID ${id} not found`);
    }

    return {
      ...result.redirect,
      targetDomain: result.targetDomain,
    };
  }

  async update(id: string, dto: UpdateRedirectDto, userId: string) {
    const existing = await this.findOne(id, userId);

    // If enabling SSL, ensure the certificate exists for the redirect source domain
    if (dto.sslEnabled === true && !existing.sslEnabled) {
      const sslResult = await this.sslCertificateService.ensureRedirectSslCert(
        existing.sourceDomain,
        existing.targetDomain,
      );
      if (!sslResult.success) {
        throw new ConflictException(
          sslResult.error || 'Failed to set up SSL for redirect. Ensure the main domain has SSL enabled.',
        );
      }
    }

    const [updated] = await db
      .update(domainRedirects)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(domainRedirects.id, id))
      .returning();

    // Regenerate nginx config if relevant fields changed
    if (
      dto.redirectType !== undefined ||
      dto.isActive !== undefined ||
      dto.sslEnabled !== undefined
    ) {
      try {
        await this.generateNginxConfig(updated.id, updated, existing.targetDomain);
      } catch (error) {
        this.logger.warn(`Failed to regenerate nginx config: ${error}`);
        // Don't fail the update - just log the warning
      }
    }

    return {
      ...updated,
      targetDomain: existing.targetDomain,
    };
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);

    // Remove nginx config
    if (existing.nginxConfigPath) {
      try {
        await this.nginxReloadService.removeConfigAndReload(existing.nginxConfigPath);
        this.logger.log(`Removed nginx config for redirect: ${existing.sourceDomain}`);
      } catch (error) {
        this.logger.warn(
          `Failed to remove nginx config (redirect will be deleted anyway): ${error}`,
        );
      }
    }

    // Remove SSL certificate if it exists
    if (existing.sslEnabled) {
      try {
        await this.sslCertificateService.removeRedirectSslCert(existing.sourceDomain);
      } catch (error) {
        this.logger.warn(`Failed to remove SSL certificate: ${error}`);
      }
    }

    await db.delete(domainRedirects).where(eq(domainRedirects.id, id));

    this.logger.log(`Deleted redirect: ${existing.sourceDomain}`);

    return { success: true };
  }

  private async generateNginxConfig(
    redirectId: string,
    redirect: typeof domainRedirects.$inferSelect,
    targetDomain: string,
  ) {
    const config = await this.nginxConfigService.generateRedirectConfig({
      sourceDomain: redirect.sourceDomain,
      targetDomain,
      redirectType: redirect.redirectType as '301' | '302',
      sslEnabled: redirect.sslEnabled,
      isActive: redirect.isActive,
    });

    const { tempPath, finalPath } = await this.nginxConfigService.writeRedirectConfigFile(
      redirectId,
      config,
    );

    if (redirect.isActive) {
      const result = await this.nginxReloadService.validateAndReload(tempPath, finalPath);
      if (!result.success) {
        throw new ConflictException(`Failed to reload nginx: ${result.error}`);
      }
    }

    // Update nginx config path in database
    await db
      .update(domainRedirects)
      .set({ nginxConfigPath: finalPath })
      .where(eq(domainRedirects.id, redirectId));
  }
}
