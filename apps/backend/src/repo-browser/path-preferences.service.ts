import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { pathPreferences, PathPreference } from '../db/schema';

export interface PathPreferenceResponse {
  id?: number;
  filepath: string;
  spaMode: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdatePathPreferenceData {
  spaMode: boolean;
}

@Injectable()
export class PathPreferencesService {
  /**
   * Get path preference for a specific project and filepath
   * Returns default values if not found
   */
  async getForPath(projectId: string, filepath: string): Promise<PathPreferenceResponse> {
    const [preference] = await db
      .select()
      .from(pathPreferences)
      .where(and(eq(pathPreferences.projectId, projectId), eq(pathPreferences.filepath, filepath)))
      .limit(1);

    if (!preference) {
      // Return default if not found
      return {
        filepath,
        spaMode: false,
      };
    }

    return {
      id: preference.id,
      filepath: preference.filepath,
      spaMode: preference.spaMode,
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    };
  }

  /**
   * Create or update path preference (upsert)
   */
  async upsert(
    projectId: string,
    filepath: string,
    data: UpdatePathPreferenceData,
  ): Promise<PathPreferenceResponse> {
    // Try to find existing preference
    const [existing] = await db
      .select()
      .from(pathPreferences)
      .where(and(eq(pathPreferences.projectId, projectId), eq(pathPreferences.filepath, filepath)))
      .limit(1);

    if (existing) {
      // Update existing
      const [updated] = await db
        .update(pathPreferences)
        .set({
          spaMode: data.spaMode,
          updatedAt: new Date(),
        })
        .where(eq(pathPreferences.id, existing.id))
        .returning();

      return {
        id: updated.id,
        filepath: updated.filepath,
        spaMode: updated.spaMode,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }

    // Create new
    const [created] = await db
      .insert(pathPreferences)
      .values({
        projectId,
        filepath,
        spaMode: data.spaMode,
      })
      .returning();

    return {
      id: created.id,
      filepath: created.filepath,
      spaMode: created.spaMode,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Delete path preference
   * Silently succeeds if preference doesn't exist
   */
  async delete(projectId: string, filepath: string): Promise<void> {
    await db
      .delete(pathPreferences)
      .where(and(eq(pathPreferences.projectId, projectId), eq(pathPreferences.filepath, filepath)));
  }
}
