#!/usr/bin/env node
// release-notes.mjs — generate human-readable release notes from conventional commits.
//
// CE squash-merges PRs with conventional titles (`type(scope)!: description (#N)`),
// so the git history of `main` is the changelog. This script turns a commit range
// into Keep-a-Changelog style sections (Breaking / Added / Fixed / Performance /
// Reverted / Maintenance / Other) with `(#N, thanks @user)` references and no
// commit hashes. It is the single source for three consumers:
//
//   stable     GitHub release body for a vX.Y.Z release
//   preview    GitHub pre-release body for a preview build
//   changelog  rewrite the release-please entry for a version in CHANGELOG.md
//   authors    collect PR author + association for a range (needs `gh`)
//   check      validate a PR title / commit subject is conventional (CI gate)
//
// Zero dependencies (Node >= 20). Tests: node --test scripts/release-notes.test.mjs
//
// Usage:
//   node scripts/release-notes.mjs stable    --tag v0.5.0 --previous v0.4.28 [--repo bffless/ce] [--authors authors.json]
//   node scripts/release-notes.mjs preview   --commit <sha> --previous <sha|tag> --base-version v0.4.28 --build-id 2026-08-15-abcdef123456 [--repo ...]
//   node scripts/release-notes.mjs changelog --tag v0.5.0 --previous v0.4.28 --date 2026-08-20 [--file CHANGELOG.md] [--authors authors.json]
//   node scripts/release-notes.mjs authors   --range v0.4.28..v0.5.0 [--repo bffless/ce]
//   node scripts/release-notes.mjs check     --subject "feat(cli): add login (#12)"   # exit 1 if not conventional
//
// All subcommands print to stdout except `changelog`, which rewrites --file in place.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REPO = 'bffless/ce';
export const DEFAULT_BRANCH = 'main';
export const INSTALL_URL = 'https://bffless.dev/install.sh';

const TYPE_SECTIONS = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Performance',
  revert: 'Reverted',
  docs: 'Maintenance',
  ci: 'Maintenance',
  test: 'Maintenance',
  refactor: 'Maintenance',
  chore: 'Maintenance',
  build: 'Maintenance',
  style: 'Maintenance',
};

export const SECTION_ORDER = [
  'Breaking',
  'Added',
  'Fixed',
  'Performance',
  'Reverted',
  'Maintenance',
  'Other',
];

/** Association values GitHub reports for people who maintain the repo (no "thanks"). */
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const HIDDEN_SUBJECT_PATTERNS = [
  /^chore(\([^)]*\))?: release\b/i, // release-please: "chore(main): release 0.4.28" / "chore: release main"
  /^chore\(changelog\):/i, // our own CHANGELOG polish commits
  /^Merge (branch|pull request|remote-tracking branch)\b/, // merge commits
];

const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s+(?<desc>.+)$/s;
const TRAILING_PR_RE = /\s*\(#(?<pr>\d+)\)\s*$/;

/**
 * Parse a commit subject (and optional body) into its conventional parts.
 * @returns {{type: string|null, scope: string|null, breaking: boolean, description: string, pr: number|null, section: string, hidden: boolean}}
 */
export function parseSubject(subject, body = '') {
  const raw = subject.trim();
  const hidden = HIDDEN_SUBJECT_PATTERNS.some((re) => re.test(raw));

  let pr = null;
  let text = raw;
  const prMatch = TRAILING_PR_RE.exec(text);
  if (prMatch) {
    pr = Number(prMatch.groups.pr);
    text = text.slice(0, prMatch.index).trim();
  }

  const breakingFooter = /(^|\n)BREAKING[ -]CHANGE:/.test(body);
  const m = CONVENTIONAL_RE.exec(text);
  if (!m || !(m.groups.type in TYPE_SECTIONS)) {
    return {
      type: null,
      scope: null,
      breaking: breakingFooter,
      description: text,
      pr,
      section: 'Other',
      hidden,
    };
  }
  const type = m.groups.type;
  return {
    type,
    scope: m.groups.scope?.trim() || null,
    breaking: Boolean(m.groups.bang) || breakingFooter,
    description: m.groups.desc.trim(),
    pr,
    section: TYPE_SECTIONS[type],
    hidden,
  };
}

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function prRef(pr, { repo, linkPrs }) {
  return linkPrs ? `[#${pr}](https://github.com/${repo}/pull/${pr})` : `#${pr}`;
}

/**
 * Render one bullet: "scope: Description (#N, thanks @user)".
 */
export function renderLine(parsed, { authors = {}, repo = DEFAULT_REPO, linkPrs = false } = {}) {
  const text = parsed.scope
    ? `${parsed.scope}: ${parsed.description}`
    : capitalize(parsed.description);
  if (parsed.pr == null) return text;
  const meta = [prRef(parsed.pr, { repo, linkPrs })];
  const who = authors[parsed.pr] ?? authors[String(parsed.pr)];
  if (who?.author && !MAINTAINER_ASSOCIATIONS.has(String(who.association ?? '').toUpperCase())) {
    meta.push(`thanks @${who.author}`);
  }
  return `${text} (${meta.join(', ')})`;
}

/**
 * Group commits into an ordered Map<section, string[]> of rendered bullets.
 * Breaking changes appear both under "Breaking" and their natural section.
 * Empty sections are omitted; hidden commits are dropped.
 */
export function groupCommits(commits, opts = {}) {
  const buckets = new Map(SECTION_ORDER.map((s) => [s, []]));
  for (const c of commits) {
    const parsed = parseSubject(c.subject, c.body ?? '');
    if (parsed.hidden) continue;
    const line = renderLine(parsed, opts);
    if (parsed.breaking) buckets.get('Breaking').push(line);
    buckets.get(parsed.section).push(line);
  }
  return new Map([...buckets].filter(([, lines]) => lines.length > 0));
}

/**
 * Render grouped sections as markdown. With `collapseMaintenance`, the
 * Maintenance section is wrapped in a <details> block so it stays out of the way.
 */
export function renderSections(groups, { collapseMaintenance = false } = {}) {
  const parts = [];
  for (const [section, lines] of groups) {
    const bullets = lines.map((l) => `- ${l}`).join('\n');
    if (section === 'Maintenance' && collapseMaintenance) {
      parts.push(`<details>\n<summary>Maintenance</summary>\n\n${bullets}\n\n</details>\n`);
    } else {
      parts.push(`### ${section}\n${bullets}\n`);
    }
  }
  return parts.join('\n');
}

function compareUrl(repo, from, to) {
  return `https://github.com/${repo}/compare/${from}...${to}`;
}

function dockerBlock(repo, tag) {
  return [
    '## Docker Images',
    '',
    '```bash',
    `docker pull ghcr.io/${repo}-frontend:${tag}`,
    `docker pull ghcr.io/${repo}-backend:${tag}`,
    `docker pull ghcr.io/${repo}-ffmpeg-worker:${tag}`,
    '```',
    '',
  ].join('\n');
}

/** Stable release body. */
export function renderStable({ tag, previous, repo = DEFAULT_REPO, commits, authors = {} }) {
  const groups = groupCommits(commits, { authors, repo });
  const body = groups.size
    ? renderSections(groups, { collapseMaintenance: true })
    : '_No user-facing changes in this release._\n';
  const install = [
    '## Install / Update',
    '',
    '```bash',
    `# New install`,
    `sh -c "$(curl -fsSL ${INSTALL_URL})"`,
    `# Existing install`,
    './update.sh',
    '```',
    '',
  ].join('\n');
  const footer = previous ? `**Full changelog**: ${compareUrl(repo, previous, tag)}\n` : '';
  return [body, dockerBlock(repo, tag), install, footer].filter(Boolean).join('\n');
}

/** Preview (pre-release) body. */
export function renderPreview({
  commit,
  previous,
  baseVersion,
  buildId,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  commits,
  authors = {},
}) {
  const shortSha = commit.slice(0, 12);
  const header = [
    `Preview build ${buildId}`,
    '',
    `Built from \`${shortSha}\` on \`${branch}\`.`,
    `Base stable: ${baseVersion}`,
    `Compare: ${compareUrl(repo, previous, commit)}`,
    '',
  ].join('\n');
  const groups = groupCommits(commits, { authors, repo });
  const body = groups.size
    ? renderSections(groups, { collapseMaintenance: false })
    : `### Changed\n- Rebuilt preview from the current ${branch} branch.\n`;
  const previewTag = `preview-${buildId}`;
  const channel = [
    '## Docker Images',
    '',
    '```bash',
    `docker pull ghcr.io/${repo}-frontend:${previewTag}`,
    `docker pull ghcr.io/${repo}-backend:${previewTag}`,
    `docker pull ghcr.io/${repo}-ffmpeg-worker:${previewTag}`,
    '```',
    '',
    `The moving \`:preview\` tag also points at this build. Opt a self-hosted install into the preview channel with \`CHANNEL=preview\` on install or \`./update.sh --channel preview\`.`,
    '',
  ].join('\n');
  return [header, body, channel].join('\n');
}

/** CHANGELOG.md entry for a version, in release-please's header format. */
export function renderChangelogEntry({
  tag,
  previous,
  date,
  repo = DEFAULT_REPO,
  commits,
  authors = {},
}) {
  const version = tag.replace(/^v/, '');
  const link = previous
    ? compareUrl(repo, previous, tag)
    : `https://github.com/${repo}/releases/tag/${tag}`;
  const header = `## [${version}](${link}) (${date})\n`;
  const groups = groupCommits(commits, { authors, repo, linkPrs: true });
  const body = groups.size
    ? renderSections(groups, { collapseMaintenance: false })
    : '_No user-facing changes in this release._\n';
  return `${header}\n${body}`;
}

/**
 * Replace the `## [version]` block in a CHANGELOG with `entry` (which must start
 * with its own `## [version]` header and end with a newline). If the version is
 * absent, insert before the first `## [` entry. Idempotent.
 */
export function replaceChangelogEntry(changelog, tag, entry) {
  const version = tag.replace(/^v/, '');
  const lines = changelog.split('\n');
  const isEntryHeader = (l) => /^## \[/.test(l);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^## \\[${escaped}\\]`).test(l));
  const entryLines = entry.replace(/\n+$/, '').split('\n');

  if (start === -1) {
    const first = lines.findIndex(isEntryHeader);
    const at = first === -1 ? lines.length : first;
    const before = lines.slice(0, at);
    while (before.length && before[before.length - 1] === '') before.pop();
    const after = lines.slice(at);
    return [...before, '', ...entryLines, '', ...after].join('\n');
  }

  let end = start + 1;
  while (end < lines.length && !isEntryHeader(lines[end])) end++;
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const out = [...before, ...entryLines];
  if (after.length) out.push('', ...after);
  else out.push('');
  return out.join('\n');
}

/**
 * Is this subject a conventional commit we know how to render? Used as the PR
 * title gate so squash commits (whose subject is the PR title) stay parseable.
 */
export function isConventional(subject) {
  return parseSubject(subject).type !== null;
}

/** Unique, sorted PR numbers referenced by a commit list. */
export function extractPrNumbers(commits) {
  const set = new Set();
  for (const c of commits) {
    const p = parseSubject(c.subject, c.body ?? '');
    if (p.pr != null) set.add(p.pr);
  }
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// git / gh plumbing
// ---------------------------------------------------------------------------

const FIELD_SEP = '\x00';
const RECORD_SEP = '\x1e';

/** Parse `git log --format=%H%x00%s%x00%b%x1e` output. */
export function parseGitLog(raw) {
  return raw
    .split(RECORD_SEP)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim().length)
    .map((r) => {
      const [sha, subject, body = ''] = r.split(FIELD_SEP);
      return { sha: sha.trim(), subject: (subject ?? '').trim(), body: body.trim() };
    });
}

export function readCommits(range) {
  // git expands %x00 / %x1e itself — argv strings must not contain NUL bytes.
  const raw = execFileSync('git', ['log', '--no-merges', '--format=%H%x00%s%x00%b%x1e', range], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseGitLog(raw);
}

/** Look up PR author + association via `gh api`. Failures degrade to "unknown". */
export function fetchAuthors(prs, repo = DEFAULT_REPO) {
  const out = {};
  for (const pr of prs) {
    try {
      const json = execFileSync(
        'gh',
        [
          'api',
          `repos/${repo}/pulls/${pr}`,
          '--jq',
          '{author: .user.login, association: .author_association}',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      out[pr] = JSON.parse(json);
    } catch {
      // PR may not exist (e.g. squash from a fork mirror) — leave it out
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else {
      opts[key] = next;
      i++;
    }
  }
  return { cmd, opts };
}

function need(opts, ...keys) {
  for (const k of keys) {
    if (opts[k] === undefined || opts[k] === true) {
      console.error(`missing --${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`);
      process.exit(2);
    }
  }
}

function loadAuthors(path) {
  if (!path) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function main(argv = process.argv.slice(2)) {
  const { cmd, opts } = parseArgs(argv);
  const repo = opts.repo ?? DEFAULT_REPO;
  switch (cmd) {
    case 'stable': {
      need(opts, 'tag', 'previous');
      const commits = readCommits(`${opts.previous}..${opts.tag}`);
      process.stdout.write(
        renderStable({
          tag: opts.tag,
          previous: opts.previous,
          repo,
          commits,
          authors: loadAuthors(opts.authors),
        }),
      );
      return 0;
    }
    case 'preview': {
      need(opts, 'commit', 'previous', 'baseVersion', 'buildId');
      const commits = readCommits(`${opts.previous}..${opts.commit}`);
      process.stdout.write(
        renderPreview({
          commit: opts.commit,
          previous: opts.previous,
          baseVersion: opts.baseVersion,
          buildId: opts.buildId,
          repo,
          branch: opts.branch ?? DEFAULT_BRANCH,
          commits,
          authors: loadAuthors(opts.authors),
        }),
      );
      return 0;
    }
    case 'changelog': {
      need(opts, 'tag', 'previous', 'date');
      const file = opts.file ?? 'CHANGELOG.md';
      const commits = readCommits(`${opts.previous}..${opts.tag}`);
      const entry = renderChangelogEntry({
        tag: opts.tag,
        previous: opts.previous,
        date: opts.date,
        repo,
        commits,
        authors: loadAuthors(opts.authors),
      });
      const current = readFileSync(file, 'utf8');
      const next = replaceChangelogEntry(current, opts.tag, entry);
      if (next !== current) writeFileSync(file, next);
      console.error(
        next === current ? `${file}: already up to date` : `${file}: rewrote entry for ${opts.tag}`,
      );
      return 0;
    }
    case 'authors': {
      need(opts, 'range');
      const commits = readCommits(opts.range);
      process.stdout.write(
        JSON.stringify(fetchAuthors(extractPrNumbers(commits), repo), null, 2) + '\n',
      );
      return 0;
    }
    case 'check': {
      need(opts, 'subject');
      if (isConventional(opts.subject)) {
        console.log(`ok: ${opts.subject}`);
        return 0;
      }
      const types = Object.keys(TYPE_SECTIONS).join('|');
      console.error(
        `Not a conventional title: "${opts.subject}"\n` +
          `Expected: <type>(<optional scope>)<optional !>: <description>\n` +
          `Types: ${types}\n` +
          `Examples: "feat(cli): add login command", "fix: survive empty token", "feat!: drop node 18"`,
      );
      return 1;
    }
    default:
      console.error(
        'usage: release-notes.mjs <stable|preview|changelog|authors|check> [--options]',
      );
      return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
