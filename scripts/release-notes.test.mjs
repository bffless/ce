// Tests for scripts/release-notes.mjs — run with: node --test scripts/release-notes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSubject,
  groupCommits,
  renderSections,
  renderStable,
  renderPreview,
  renderChangelogEntry,
  replaceChangelogEntry,
  extractPrNumbers,
  parseGitLog,
  isConventional,
} from './release-notes.mjs';

const REPO = 'bffless/ce';

test('parseSubject: type, scope, pr, breaking marker', () => {
  const p = parseSubject('feat(cli)!: add login command (#123)');
  assert.equal(p.type, 'feat');
  assert.equal(p.scope, 'cli');
  assert.equal(p.breaking, true);
  assert.equal(p.description, 'add login command');
  assert.equal(p.pr, 123);
  assert.equal(p.section, 'Added');
});

test('parseSubject: maps types to sections', () => {
  assert.equal(parseSubject('fix: x').section, 'Fixed');
  assert.equal(parseSubject('perf: x').section, 'Performance');
  assert.equal(parseSubject('revert: x').section, 'Reverted');
  for (const t of ['docs', 'ci', 'test', 'refactor', 'chore', 'build', 'style']) {
    assert.equal(parseSubject(`${t}: x`).section, 'Maintenance', t);
  }
});

test('parseSubject: non-conventional subject lands in Other, no type', () => {
  const p = parseSubject('AI settings clarity: name the cards (#637)');
  assert.equal(p.type, null);
  assert.equal(p.section, 'Other');
  assert.equal(p.pr, 637);
  assert.equal(p.description, 'AI settings clarity: name the cards');
});

test('parseSubject: hidden subjects', () => {
  assert.equal(parseSubject('chore(main): release 0.4.28 (#661)').hidden, true);
  assert.equal(parseSubject('chore: release main (#661)').hidden, true);
  assert.equal(parseSubject('chore(changelog): polish v0.4.28 notes').hidden, true);
  assert.equal(parseSubject("Merge branch 'main' into foo").hidden, true);
  assert.equal(parseSubject('Merge pull request #1 from x/y').hidden, true);
  assert.equal(parseSubject('chore: bump deps (#5)').hidden, false);
});

test('parseSubject: BREAKING CHANGE footer marks breaking', () => {
  const p = parseSubject(
    'feat: drop node 18 (#9)',
    'Some body\n\nBREAKING CHANGE: node 20 required',
  );
  assert.equal(p.breaking, true);
});

test('groupCommits: orders sections, capitalizes, keeps scope, adds thanks', () => {
  const commits = [
    { subject: 'chore: tidy ci (#3)', body: '' },
    { subject: 'fix(cli): handle empty token (#2)', body: '' },
    { subject: 'feat!: new auth flow (#1)', body: '' },
    { subject: 'feat: add thing (#4)', body: '' },
    { subject: 'chore(main): release 0.1.0 (#5)', body: '' },
  ];
  const authors = {
    2: { author: 'alice', association: 'CONTRIBUTOR' },
    4: { author: 'toshimoto821', association: 'OWNER' },
  };
  const groups = groupCommits(commits, { authors });
  assert.deepEqual([...groups.keys()], ['Breaking', 'Added', 'Fixed', 'Maintenance']);
  assert.deepEqual(groups.get('Breaking'), ['New auth flow (#1)']);
  assert.deepEqual(groups.get('Added'), ['New auth flow (#1)', 'Add thing (#4)']);
  assert.deepEqual(groups.get('Fixed'), ['cli: handle empty token (#2, thanks @alice)']);
  assert.deepEqual(groups.get('Maintenance'), ['Tidy ci (#3)']);
});

test('groupCommits: description without pr number renders bare', () => {
  const groups = groupCommits([{ subject: 'fix: no pr here', body: '' }], {});
  assert.deepEqual(groups.get('Fixed'), ['No pr here']);
});

test('groupCommits: pr link mode renders markdown links', () => {
  const groups = groupCommits([{ subject: 'fix: thing (#7)', body: '' }], {
    repo: REPO,
    linkPrs: true,
  });
  assert.deepEqual(groups.get('Fixed'), ['Thing ([#7](https://github.com/bffless/ce/pull/7))']);
});

test('renderSections: collapses Maintenance into details when asked', () => {
  const groups = new Map([
    ['Added', ['A (#1)']],
    ['Maintenance', ['M (#2)']],
  ]);
  const out = renderSections(groups, { collapseMaintenance: true });
  assert.match(out, /### Added\n- A \(#1\)\n/);
  assert.match(out, /<details>\n<summary>Maintenance<\/summary>\n\n- M \(#2\)\n\n<\/details>/);
  assert.doesNotMatch(out, /### Maintenance/);
  const inline = renderSections(groups, { collapseMaintenance: false });
  assert.match(inline, /### Maintenance\n- M \(#2\)/);
});

test('renderStable: sections + docker + install + compare', () => {
  const commits = [
    { subject: 'feat: add thing (#4)', body: '' },
    { subject: 'ci: bump action (#6)', body: '' },
  ];
  const out = renderStable({
    tag: 'v0.5.0',
    previous: 'v0.4.28',
    repo: REPO,
    commits,
    authors: {},
  });
  assert.match(out, /^### Added\n- Add thing \(#4\)\n/);
  assert.match(out, /<summary>Maintenance<\/summary>/);
  assert.match(
    out,
    /## Docker Images\n\n```bash\ndocker pull ghcr\.io\/bffless\/ce-frontend:v0\.5\.0\ndocker pull ghcr\.io\/bffless\/ce-backend:v0\.5\.0\ndocker pull ghcr\.io\/bffless\/ce-ffmpeg-worker:v0\.5\.0\n```/,
  );
  assert.match(out, /## Install \/ Update/);
  assert.match(out, /https:\/\/bffless\.dev\/install\.sh/);
  assert.match(
    out,
    /\*\*Full changelog\*\*: https:\/\/github\.com\/bffless\/ce\/compare\/v0\.4\.28\.\.\.v0\.5\.0/,
  );
});

test('renderStable: empty range says so instead of empty body', () => {
  const out = renderStable({
    tag: 'v0.5.0',
    previous: 'v0.4.28',
    repo: REPO,
    commits: [],
    authors: {},
  });
  assert.match(out, /No user-facing changes/);
});

test('renderPreview: header, sections, fallback and docker block', () => {
  const base = {
    commit: 'd78e3d3b51266a1ff80ae6858b894e782aac3e9f',
    previous: 'v0.4.28',
    baseVersion: 'v0.4.28',
    buildId: '2026-08-15-d78e3d3b5126',
    repo: REPO,
  };
  const out = renderPreview({
    ...base,
    commits: [
      { subject: 'fix: keep status visible (#2239)', body: '' },
      { subject: 'docs: refine blog post', body: '' },
    ],
  });
  assert.match(
    out,
    /^Preview build 2026-08-15-d78e3d3b5126\n\nBuilt from `d78e3d3b5126` on `main`\.\nBase stable: v0\.4\.28\nCompare: https:\/\/github\.com\/bffless\/ce\/compare\/v0\.4\.28\.\.\.d78e3d3b51266a1ff80ae6858b894e782aac3e9f\n/,
  );
  assert.match(out, /### Fixed\n- Keep status visible \(#2239\)\n/);
  assert.match(out, /### Maintenance\n- Refine blog post\n/);
  assert.match(out, /docker pull ghcr\.io\/bffless\/ce-backend:preview-2026-08-15-d78e3d3b5126/);
  assert.match(out, /:preview/);
  const empty = renderPreview({ ...base, commits: [] });
  assert.match(empty, /### Changed\n- Rebuilt preview from the current main branch\./);
});

test('renderChangelogEntry: release-please compatible header, linked PRs, no docker footer', () => {
  const out = renderChangelogEntry({
    tag: 'v0.5.0',
    previous: 'v0.4.28',
    date: '2026-08-20',
    repo: REPO,
    commits: [{ subject: 'feat: add thing (#4)', body: '' }],
    authors: {},
  });
  assert.match(
    out,
    /^## \[0\.5\.0\]\(https:\/\/github\.com\/bffless\/ce\/compare\/v0\.4\.28\.\.\.v0\.5\.0\) \(2026-08-20\)\n\n### Added\n- Add thing \(\[#4\]\(https:\/\/github\.com\/bffless\/ce\/pull\/4\)\)\n/,
  );
  assert.doesNotMatch(out, /Docker/);
});

const CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [0.4.28](https://github.com/bffless/ce/compare/v0.4.27...v0.4.28) (2026-08-13)


### Features

* run swap setup ([#660](https://github.com/bffless/ce/issues/660)) ([428f982](https://github.com/bffless/ce/commit/428f982))

## [0.4.27](https://github.com/bffless/ce/compare/v0.4.26...v0.4.27) (2026-08-13)


### Bug Fixes

* pin SuperTokens ([#658](https://github.com/bffless/ce/issues/658)) ([6f15dec](https://github.com/bffless/ce/commit/6f15dec))
`;

test('replaceChangelogEntry: replaces only the matching block and is idempotent', () => {
  const entry =
    '## [0.4.28](https://github.com/bffless/ce/compare/v0.4.27...v0.4.28) (2026-08-13)\n\n### Added\n- Run swap setup ([#660](https://github.com/bffless/ce/pull/660))\n';
  const once = replaceChangelogEntry(CHANGELOG, 'v0.4.28', entry);
  assert.match(once, /### Added\n- Run swap setup/);
  assert.doesNotMatch(once, /### Features/);
  assert.match(once, /## \[0\.4\.27\][\s\S]*### Bug Fixes/); // untouched
  assert.equal(replaceChangelogEntry(once, 'v0.4.28', entry), once);
  // exactly one blank line between blocks
  assert.match(once, /pull\/660\)\)\n\n## \[0\.4\.27\]/);
});

test('replaceChangelogEntry: inserts before first entry when the version is missing', () => {
  const entry =
    '## [0.5.0](https://github.com/bffless/ce/compare/v0.4.28...v0.5.0) (2026-08-20)\n\n### Added\n- New (#1)\n';
  const out = replaceChangelogEntry(CHANGELOG, 'v0.5.0', entry);
  assert.match(out, /documented in this file\.\n\n## \[0\.5\.0\][\s\S]*\n\n## \[0\.4\.28\]/);
});

test('extractPrNumbers: unique, sorted', () => {
  assert.deepEqual(
    extractPrNumbers([
      { subject: 'a (#5)', body: '' },
      { subject: 'b (#2)', body: '' },
      { subject: 'c (#5)', body: '' },
      { subject: 'd', body: '' },
    ]),
    [2, 5],
  );
});

test('parseGitLog: splits NUL/RS separated records', () => {
  const raw = 'abc\x00feat: a (#1)\x00body a\x1e' + 'def\x00fix: b\x00\x1e';
  assert.deepEqual(parseGitLog(raw), [
    { sha: 'abc', subject: 'feat: a (#1)', body: 'body a' },
    { sha: 'def', subject: 'fix: b', body: '' },
  ]);
});

test('isConventional: PR title gate', () => {
  assert.equal(isConventional('feat(cli): add login command'), true);
  assert.equal(isConventional('fix!: drop node 18 (#9)'), true);
  assert.equal(isConventional('chore(main): release 0.5.0'), true);
  assert.equal(isConventional('Feat: capitalised type'), false);
  assert.equal(isConventional('AI settings clarity: name the cards'), false);
  assert.equal(isConventional('update readme'), false);
  assert.equal(isConventional('feat:missing space'), false);
});
