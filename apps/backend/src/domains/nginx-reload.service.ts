import { Injectable, Logger } from '@nestjs/common';
import { copyFile, unlink, access } from 'fs/promises';

@Injectable()
export class NginxReloadService {
  private readonly logger = new Logger(NginxReloadService.name);

  /**
   * Write config file and let nginx watcher handle reload.
   *
   * The nginx container has a file watcher (inotify) that:
   * 1. Detects file changes in /etc/nginx/sites-enabled/
   * 2. Validates the config with `nginx -t`
   * 3. If valid, reloads nginx with `nginx -s reload`
   * 4. If invalid, skips reload and logs error
   */
  async validateAndReload(
    tempConfigPath: string,
    finalConfigPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Copy config to final location (can't use rename across filesystems in Docker)
      this.logger.log(`Copying config to: ${finalConfigPath}`);
      await copyFile(tempConfigPath, finalConfigPath);
      await unlink(tempConfigPath);

      // File watcher will detect change and reload automatically
      this.logger.log('Config written, nginx watcher will reload automatically (2-5s)');

      // Wait for watcher to process
      // The watcher script validates and reloads, skipping invalid configs
      await this.waitForReload();

      this.logger.log('Nginx reload should be complete');
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to write config', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete config file and let nginx watcher handle reload
   */
  async removeConfigAndReload(
    nginxConfigPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if file exists before attempting delete
      await access(nginxConfigPath);

      // Delete config file
      await unlink(nginxConfigPath);
      this.logger.log(`Deleted config: ${nginxConfigPath}`);

      // File watcher will detect deletion and reload nginx
      this.logger.log('Config deleted, nginx watcher will reload automatically');

      // Wait for watcher to process
      await this.waitForReload();

      return { success: true };
    } catch (error) {
      // If file doesn't exist, that's ok - it might have already been deleted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(`Config file not found (already deleted?): ${nginxConfigPath}`);
        return { success: true };
      }

      this.logger.error('Failed to delete config', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Wait for the nginx file watcher to process the config change.
   * The watcher has a ~1s delay after detecting changes, plus validation time.
   */
  private async waitForReload(): Promise<void> {
    const waitTime = parseInt(process.env.NGINX_RELOAD_WAIT_MS || '3000', 10);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}
