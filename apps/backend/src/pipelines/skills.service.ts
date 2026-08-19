import { Injectable, Inject, Logger } from '@nestjs/common';
import { STORAGE_ADAPTER, IStorageAdapter } from '../storage/storage.interface';

/**
 * Summary of a skill (returned from listSkills)
 */
export interface SkillSummary {
  name: string;
  description: string;
}

/**
 * Full skill content (returned from loadSkill)
 */
export interface Skill extends SkillSummary {
  content: string;
}

/**
 * Parsed SKILL.md frontmatter
 */
interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
}

/**
 * Service for listing and loading AI skills from storage.
 *
 * Skills are markdown files with YAML frontmatter that provide specialized
 * knowledge and instructions to AI agents. They are stored in the deployment's
 * storage under a configurable path (default: .bffless/skills/).
 *
 * Skill file formats:
 * 1. Directory with SKILL.md: .bffless/skills/{skill-name}/SKILL.md
 * 2. Single file: .bffless/skills/{skill-name}.md
 *
 * Required frontmatter:
 * ---
 * name: skill-name
 * description: Brief description of what this skill does
 * ---
 */
@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter) {}

  /**
   * List all available skills for a deployment.
   *
   * @param owner Repository owner
   * @param repo Repository name
   * @param commitSha Commit SHA
   * @param skillsPath Path to skills directory (default: .bffless/skills)
   * @returns Array of skill summaries with name and description
   */
  async listSkills(
    owner: string,
    repo: string,
    commitSha: string,
    skillsPath: string = '.bffless/skills',
  ): Promise<SkillSummary[]> {
    const prefix = `${owner}/${repo}/commits/${commitSha}/${skillsPath}/`;

    try {
      const keys = await this.storageAdapter.listKeys(prefix);

      // Filter for skill files: either SKILL.md in directories or {name}.md files
      const skillFiles = keys.filter((k) => {
        const relativePath = k.slice(prefix.length);
        // Match: {name}/SKILL.md or {name}.md (not nested further)
        return (
          relativePath.endsWith('/SKILL.md') ||
          (relativePath.endsWith('.md') && !relativePath.includes('/'))
        );
      });

      const skills: SkillSummary[] = [];

      for (const key of skillFiles) {
        try {
          const content = await this.storageAdapter.download(key);
          const parsed = this.parseSkillFile(content.toString('utf-8'));

          if (parsed) {
            skills.push({
              name: parsed.name,
              description: parsed.description,
            });
          }
        } catch (e) {
          this.logger.warn(`Failed to parse skill at ${key}: ${e.message}`);
        }
      }

      this.logger.debug(`Found ${skills.length} skills at ${prefix}`);
      return skills;
    } catch (e) {
      this.logger.debug(`No skills found at ${prefix}: ${e.message}`);
      return [];
    }
  }

  /**
   * Load a specific skill by name.
   *
   * @param owner Repository owner
   * @param repo Repository name
   * @param commitSha Commit SHA
   * @param skillsPath Path to skills directory
   * @param skillName Name of the skill to load
   * @returns Full skill content or null if not found
   */
  async loadSkill(
    owner: string,
    repo: string,
    commitSha: string,
    skillsPath: string,
    skillName: string,
  ): Promise<Skill | null> {
    const basePath = `${owner}/${repo}/commits/${commitSha}/${skillsPath}/${skillName}`;

    // Try SKILL.md first (directory format), then {name}.md (single file format)
    const pathsToTry = [`${basePath}/SKILL.md`, `${basePath}.md`];

    for (const path of pathsToTry) {
      try {
        const content = await this.storageAdapter.download(path);
        const parsed = this.parseSkillFile(content.toString('utf-8'));

        if (parsed) {
          this.logger.debug(`Loaded skill '${skillName}' from ${path}`);
          return {
            name: parsed.name,
            description: parsed.description,
            content: parsed.body,
          };
        }
      } catch (e) {
        // File not found, try next path
        continue;
      }
    }

    this.logger.warn(`Skill '${skillName}' not found at ${basePath}`);
    return null;
  }

  /**
   * Parse a skill file with YAML frontmatter.
   *
   * Expected format:
   * ---
   * name: skill-name
   * description: Brief description
   * ---
   * # Skill content markdown...
   *
   * @param content Raw file content
   * @returns Parsed skill data or null if invalid
   */
  private parseSkillFile(content: string): ParsedSkillFile | null {
    // Match YAML frontmatter delimited by ---
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!match) {
      return null;
    }

    const frontmatter = match[1];
    const body = match[2].trim();

    // Extract name and description from frontmatter
    // Simple line-based parsing (not full YAML parser to avoid dependencies)
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch || !descMatch) {
      return null;
    }

    // Handle quoted strings in YAML
    const name = this.unquoteYamlString(nameMatch[1].trim());
    const description = this.unquoteYamlString(descMatch[1].trim());

    if (!name || !description) {
      return null;
    }

    return {
      name,
      description,
      body,
    };
  }

  /**
   * Remove surrounding quotes from a YAML string value.
   */
  private unquoteYamlString(value: string): string {
    // Remove single or double quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
}
