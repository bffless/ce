/**
 * `rules revisions` — list captured revisions for a rule set (GET
 * /api/proxy-rule-sets/:id/revisions), newest first, exactly as the server sends them.
 *
 * Read-only: name → id resolution (same `createClient` → `requireProject` →
 * `resolveProjectId` → `resolveRuleSetId` chain as `rules diff`/`push`), then one GET.
 */
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { requireProject, resolveProjectId, resolveRuleSetId } from '../api/resolve.js';
import { findConfig } from '../config.js';
import type { RevisionListItem, RevisionListResponse } from '../api/sync-types.js';

export interface RevisionsOptions {
  apiUrl?: string;
  apiKey?: string;
  project?: string;
}

export interface RevisionsOutcome {
  ok: boolean;
  revisions?: RevisionListItem[];
  error?: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse `<n><unit> ago` age, matching the granularity a human scans a revision list at. */
function formatAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < MINUTE) return `${sec}s ago`;
  if (sec < HOUR) return `${Math.floor(sec / MINUTE)}m ago`;
  if (sec < DAY) return `${Math.floor(sec / HOUR)}h ago`;
  return `${Math.floor(sec / DAY)}d ago`;
}

const TABLE_HEADER = ['ID', 'AGE', 'TRIGGER', 'RULES', 'CURRENT', 'SOURCE'];

/** Render a revision list as a plain-text table: short id (8 chars), age, trigger, rule
 *  count, a `current` marker, and `repo@shortSha` when the revision carries source metadata. */
export function formatRevisionsTable(revisions: RevisionListItem[]): string {
  if (revisions.length === 0) return '(no revisions captured yet)';

  const rows = revisions.map((r) => [
    r.id.slice(0, 8),
    formatAge(r.createdAt),
    r.trigger,
    String(r.ruleCount),
    r.current ? 'current' : '',
    r.source?.repo && r.source?.gitSha ? `${r.source.repo}@${r.source.gitSha.slice(0, 7)}` : '',
  ]);

  const widths = TABLE_HEADER.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const formatRow = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [formatRow(TABLE_HEADER), ...rows.map(formatRow)].join('\n');
}

export async function runRevisionsList(
  setName: string,
  opts: RevisionsOptions,
  cwd: string,
  deps?: ClientDeps,
): Promise<RevisionsOutcome> {
  try {
    const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
    const client = createClient(opts, cwd, { ...deps, config });
    const project = requireProject(opts.project, config?.project);
    const projectId = await resolveProjectId(client, project);
    const ruleSetId = await resolveRuleSetId(client, projectId, setName);
    const { revisions } = await client.get<RevisionListResponse>(
      `/api/proxy-rule-sets/${ruleSetId}/revisions`,
      `rule set "${setName}" (${ruleSetId}) revisions`,
    );
    return { ok: true, revisions };
  } catch (err) {
    if (err instanceof ApiError || err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}
