import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { installedApps, type InstalledApp } from '../db/schema';
import { ProjectsService } from '../projects/projects.service';
import type { AppManifest } from './app-manifest.types';

export interface EjectPayload {
  repo: string;
  appPath: string;
  deployWorkflow: string;
  /** https://github.com/<repo>/fork */
  forkUrl: string;
  variables: Record<string, string>;
  secrets: string[];
  alias: string;
  note: string;
}

@Injectable()
export class AppCatalogService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {}

  async listCatalog(): Promise<unknown[]> {
    return [];
  }

  /**
   * Renders the "eject to your own repo" panel straight from the stored
   * manifest — no registry refetch, so eject still works offline / after the
   * bundle has moved on. API-key minting stays a frontend concern (the
   * existing api-keys endpoints already cover it); this only tells the
   * caller which secret name the workflow expects.
   */
  async ejectPayload(installedAppId: string): Promise<EjectPayload> {
    const row = await this.requireRow(installedAppId);
    const manifest = row.manifest as AppManifest;
    if (!manifest.eject) {
      throw new NotFoundException(`App ${row.appId} does not declare an eject configuration`);
    }

    const project = await this.projectsService.getProjectById(row.projectId);

    return {
      repo: manifest.eject.repo,
      appPath: manifest.eject.appPath,
      deployWorkflow: manifest.eject.deployWorkflow,
      forkUrl: `https://github.com/${manifest.eject.repo}/fork`,
      variables: {
        BFFLESS_URL: this.adminOrigin(),
        BFFLESS_PROJECT: `${project.owner}/${project.name}`,
      },
      secrets: manifest.eject.secrets,
      alias: row.alias,
      note: "The workflow's first deploy lands on this same alias.",
    };
  }

  /** Idempotent: acking an already-acked step id is a no-op, not a duplicate entry. */
  async ackManualStep(installedAppId: string, stepId: string): Promise<string[]> {
    const row = await this.requireRow(installedAppId);
    const acked = new Set(row.manualStepsAcked ?? []);
    acked.add(stepId);
    const updated = [...acked];

    await db
      .update(installedApps)
      .set({ manualStepsAcked: updated, updatedAt: new Date() })
      .where(eq(installedApps.id, row.id));

    return updated;
  }

  /**
   * `PUBLIC_ORIGIN` wins when set (an explicit override); otherwise the app's
   * eject target is always reachable at the admin host, so — unlike
   * `presign.util.ts`'s `explicitPublicOrigin` — falling back to
   * `PRIMARY_DOMAIN` here is correct rather than a guess.
   */
  private adminOrigin(): string {
    const explicit = this.configService.get<string>('PUBLIC_ORIGIN')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const primaryDomain = this.configService.get<string>('PRIMARY_DOMAIN')?.trim() ?? '';
    return `https://admin.${primaryDomain}`;
  }

  private async requireRow(installedAppId: string): Promise<InstalledApp> {
    const [row] = await db
      .select()
      .from(installedApps)
      .where(eq(installedApps.id, installedAppId))
      .limit(1);
    if (!row) throw new NotFoundException(`Installed app ${installedAppId} not found`);
    return row;
  }
}
