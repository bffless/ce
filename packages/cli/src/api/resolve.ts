/**
 * Name → id resolution against the backend's UUID-addressed API.
 *
 * - Projects: the config `project` value (or `--project` flag) may be a UUID (used directly),
 *   an `owner/name` pair, or a bare project name.
 *   `owner/name` resolves through `GET /api/projects/:owner/:name`, which is access-scoped
 *   (`RequireProjectRole('viewer')`). A bare name has no such endpoint, so it falls back to
 *   `GET /api/projects` — but that list is *creator*-scoped (`projects.createdBy`), so a key
 *   whose user was granted a role on a project they didn't create sees nothing there. Bare
 *   names are therefore best-effort; `owner/name` is the form that works for any member.
 * - Rule sets: `GET /api/proxy-rule-sets/project/:projectId` lists `{ruleSets: [{id, name}]}`;
 *   matched by exact name.
 *
 * Every failure message states exactly what was tried (URL + name) and what IS available,
 * so a typo'd name is a one-glance fix.
 */
import { UUID_RE } from '../format/routes.js';
import { ApiError, type ApiClient } from './client.js';

export interface ProjectListItem {
  id: string;
  owner: string;
  name: string;
}

export interface RuleSetListItem {
  id: string;
  name: string;
}

const LIST_PATH = '/api/projects';

/** Resolve a project identifier (UUID | `owner/name` | bare name) to its UUID. */
export async function resolveProjectId(client: ApiClient, project: string): Promise<string> {
  if (UUID_RE.test(project)) return project;

  const slash = project.indexOf('/');
  if (slash === -1) return resolveBareName(client, project);
  return resolveOwnerName(client, project, project.slice(0, slash), project.slice(slash + 1));
}

/**
 * `owner/name` → the access-scoped `GET /api/projects/:owner/:name`, so a key belonging to any
 * member (not just the project's creator) resolves it.
 *
 * A project that doesn't exist surfaces as 400 from `ProjectPermissionGuard` ("Project not
 * found") rather than 404, so both statuses mean "no such project" here. A 403 — the key's user
 * exists but has no role — is a genuinely different failure and propagates untouched.
 */
async function resolveOwnerName(
  client: ApiClient,
  project: string,
  owner: string,
  name: string,
): Promise<string> {
  const path = `${LIST_PATH}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  try {
    const found = await client.get<ProjectListItem>(path, `project "${project}"`);
    if (!found?.id) throw new Error(`GET ${client.url(path)} returned no project id`);
    return found.id;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
      throw new Error(
        `project "${project}" via GET ${client.url(path)}: no match — it does not exist, ` +
          `or the API key's user has no role on it.${await createdProjectsHint(client)}`,
      );
    }
    throw err;
  }
}

/** A bare name can only be matched client-side, against the creator-scoped project list. */
async function resolveBareName(client: ApiClient, project: string): Promise<string> {
  const projects = await client.get<ProjectListItem[]>(LIST_PATH, 'project list');
  const matches = projects.filter((p) => p.name === project);
  if (matches.length === 1) return matches[0].id;

  const tried = `project "${project}" via GET ${client.url(LIST_PATH)}`;
  if (matches.length === 0) {
    const available = projects.map((p) => `${p.owner}/${p.name}`).sort();
    throw new Error(
      `${tried}: no match. That endpoint lists only projects created by the API key's user — ` +
        `use owner/name (or the project UUID) to reach a project shared with them. ` +
        `Available projects: ${available.length > 0 ? available.join(', ') : '(none)'}`,
    );
  }
  const candidates = matches.map((p) => `${p.owner}/${p.name}`).join(', ');
  throw new Error(`${tried}: ambiguous — matches ${candidates}. Use owner/name or the project UUID.`);
}

/** Best-effort " Projects created by …: a/b, c/d" suffix for a failed owner/name lookup — a
 *  typo'd name is the likeliest cause, and this names the near-misses. Silent when the list
 *  is empty or itself fails: the caller already has a complete error without it. */
async function createdProjectsHint(client: ApiClient): Promise<string> {
  try {
    const projects = await client.get<ProjectListItem[]>(LIST_PATH, 'project list');
    const available = projects.map((p) => `${p.owner}/${p.name}`).sort();
    if (available.length === 0) return '';
    return ` Projects created by the API key's user: ${available.join(', ')}`;
  } catch {
    return '';
  }
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
