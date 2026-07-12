/**
 * Name → id resolution against the backend's UUID-addressed API.
 *
 * - Projects: `GET /api/projects` lists the caller's projects (`{id, owner, name}` each).
 *   The config `project` value (or `--project` flag) may be a UUID (used directly), an
 *   `owner/name` pair, or a bare project name (errors if two owners share it).
 * - Rule sets: `GET /api/proxy-rule-sets/project/:projectId` lists `{ruleSets: [{id, name}]}`;
 *   matched by exact name.
 *
 * Every failure message states exactly what was tried (URL + name) and what IS available,
 * so a typo'd name is a one-glance fix.
 */
import { UUID_RE } from '../format/routes.js';
import type { ApiClient } from './client.js';

export interface ProjectListItem {
  id: string;
  owner: string;
  name: string;
}

export interface RuleSetListItem {
  id: string;
  name: string;
}

/** Resolve a project identifier (UUID | `owner/name` | bare name) to its UUID. */
export async function resolveProjectId(client: ApiClient, project: string): Promise<string> {
  if (UUID_RE.test(project)) return project;

  const listPath = '/api/projects';
  const projects = await client.get<ProjectListItem[]>(listPath, 'project list');
  const available = projects.map((p) => `${p.owner}/${p.name}`).sort();

  let matches: ProjectListItem[];
  if (project.includes('/')) {
    const [owner, name] = project.split('/', 2);
    matches = projects.filter((p) => p.owner === owner && p.name === name);
  } else {
    matches = projects.filter((p) => p.name === project);
  }

  if (matches.length === 1) return matches[0].id;
  const tried = `project "${project}" via GET ${client.url(listPath)}`;
  if (matches.length === 0) {
    throw new Error(
      `${tried}: no match. Available projects: ${available.length > 0 ? available.join(', ') : '(none)'}`,
    );
  }
  const candidates = matches.map((p) => `${p.owner}/${p.name}`).join(', ');
  throw new Error(`${tried}: ambiguous — matches ${candidates}. Use owner/name or the project UUID.`);
}

/** Find a rule set by exact name within a project; `null` when the project has no set by
 *  that name (callers decide whether that's an error — `diff` treats it as drift). */
export async function findRuleSetByName(
  client: ApiClient,
  projectId: string,
  setName: string,
): Promise<RuleSetListItem | null> {
  const listPath = `/api/proxy-rule-sets/project/${projectId}`;
  const { ruleSets } = await client.get<{ ruleSets: RuleSetListItem[] }>(
    listPath,
    `rule sets for project ${projectId}`,
  );
  return ruleSets.find((s) => s.name === setName) ?? null;
}

/** Resolve a rule-set name to its UUID, erroring with the names that DO exist. */
export async function resolveRuleSetId(
  client: ApiClient,
  projectId: string,
  setName: string,
): Promise<string> {
  const listPath = `/api/proxy-rule-sets/project/${projectId}`;
  const { ruleSets } = await client.get<{ ruleSets: RuleSetListItem[] }>(
    listPath,
    `rule sets for project ${projectId}`,
  );
  const match = ruleSets.find((s) => s.name === setName);
  if (match) return match.id;
  const available = ruleSets.map((s) => s.name).sort();
  throw new Error(
    `rule set "${setName}" not found via GET ${client.url(listPath)}. ` +
      `Available rule sets: ${available.length > 0 ? available.join(', ') : '(none)'}`,
  );
}

/** The project to operate on: `--project` flag > config `project`. Throws when neither is set. */
export function requireProject(flagProject: string | undefined, configProject: string | undefined): string {
  const project = flagProject ?? configProject;
  if (!project) {
    throw new Error(
      'no project configured — pass --project <uuid|owner/name|name> ' +
        'or add "project" to .bffless/config.json',
    );
  }
  return project;
}
