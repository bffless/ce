import { describe, it, expect } from 'vitest';
import { formatDocumentTitle, getRouteTitleParts } from './pageTitle';

const titleFor = (url: string, siteName = 'BFFLESS') => {
  const [pathname, search] = url.split('?');
  return formatDocumentTitle(getRouteTitleParts(pathname, new URLSearchParams(search)), siteName);
};

describe('getRouteTitleParts', () => {
  it('returns no parts for the home route, so the site name stands alone', () => {
    expect(getRouteTitleParts('/')).toEqual([]);
    expect(titleFor('/')).toBe('BFFLESS');
  });

  it('titles the auth routes', () => {
    expect(titleFor('/login')).toBe('Sign in · BFFLESS');
    expect(titleFor('/signup')).toBe('Sign up · BFFLESS');
    expect(titleFor('/setup')).toBe('Setup · BFFLESS');
    expect(titleFor('/invite/abc123')).toBe('Accept invitation · BFFLESS');
  });

  it('reads the user settings tab from the query string', () => {
    expect(titleFor('/settings')).toBe('Profile · Settings · BFFLESS');
    expect(titleFor('/settings?tab=api-keys')).toBe('API Keys · Settings · BFFLESS');
    expect(titleFor('/settings?tab=sites')).toBe('My Sites · Settings · BFFLESS');
    // Unknown tab falls back to the default tab, matching UserSettingsPage.
    expect(titleFor('/settings?tab=nope')).toBe('Profile · Settings · BFFLESS');
  });

  it('titles admin settings tabs from their nested routes', () => {
    expect(titleFor('/admin/settings')).toBe('General · Admin settings · BFFLESS');
    expect(titleFor('/admin/settings/ssl')).toBe('SSL · Admin settings · BFFLESS');
    expect(titleFor('/admin/settings/infrastructure')).toBe(
      'Infrastructure · Admin settings · BFFLESS',
    );
  });

  it('includes owner/repo on repository tabs', () => {
    expect(titleFor('/repo')).toBe('Repositories · BFFLESS');
    expect(titleFor('/repo/acme/site')).toBe('acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/deployments')).toBe('Deployments · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/aliases')).toBe('Aliases · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/settings')).toBe('Settings · acme/site · BFFLESS');
  });

  it('distinguishes the nested proxy-rule routes', () => {
    expect(titleFor('/repo/acme/site/proxy-rules')).toBe('Proxy Rules · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/proxy-rules/rs1')).toBe(
      'Rule set · Proxy Rules · acme/site · BFFLESS',
    );
    expect(titleFor('/repo/acme/site/proxy-rules/rs1/new')).toBe(
      'New rule · Proxy Rules · acme/site · BFFLESS',
    );
    expect(titleFor('/repo/acme/site/proxy-rules/rs1/r1')).toBe(
      'Rule · Proxy Rules · acme/site · BFFLESS',
    );
    expect(titleFor('/repo/acme/site/proxy-rules/rs1/r1/logs')).toBe(
      'Logs · Proxy Rules · acme/site · BFFLESS',
    );
  });

  it('distinguishes the nested data routes', () => {
    expect(titleFor('/repo/acme/site/data')).toBe('Data · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/data/new')).toBe('New schema · Data · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/data/s1')).toBe('Schema · Data · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/data/s1/edit')).toBe(
      'Edit schema · Data · acme/site · BFFLESS',
    );
    expect(titleFor('/repo/acme/site/uploads')).toBe('Uploads · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/uploads/s1')).toBe('Schema · Uploads · acme/site · BFFLESS');
  });

  it('shows the file path in the repository file browser', () => {
    expect(titleFor('/repo/acme/site/main')).toBe('Files · acme/site · BFFLESS');
    expect(titleFor('/repo/acme/site/main/src/index.html')).toBe(
      'src/index.html · acme/site · BFFLESS',
    );
  });

  it('does not let the file-browser pattern swallow the repository tabs', () => {
    // '/repo/:owner/:repo/:ref' would match these too — static segments win.
    for (const tab of ['deployments', 'branches', 'aliases', 'proxy-rules', 'schedules', 'data', 'uploads']) {
      expect(getRouteTitleParts(`/repo/acme/site/${tab}`)[0]).not.toBe('Files');
    }
  });

  it('titles the admin-only sections', () => {
    expect(titleFor('/users')).toBe('Users · BFFLESS');
    expect(titleFor('/domains')).toBe('Domains · BFFLESS');
    expect(titleFor('/traffic')).toBe('Traffic · BFFLESS');
    expect(titleFor('/groups')).toBe('User groups · BFFLESS');
    expect(titleFor('/groups/g1')).toBe('Group · User groups · BFFLESS');
  });

  it('falls back to the bare site name for unmapped URLs', () => {
    expect(getRouteTitleParts('/nope/nowhere')).toEqual([]);
    expect(titleFor('/nope/nowhere')).toBe('BFFLESS');
  });

  it('uses the branded site name', () => {
    expect(titleFor('/users', 'Acme Deploys')).toBe('Users · Acme Deploys');
  });
});

describe('formatDocumentTitle', () => {
  it('drops empty parts', () => {
    expect(formatDocumentTitle(['Logs', '', 'acme/site'], 'BFFLESS')).toBe(
      'Logs · acme/site · BFFLESS',
    );
  });
});
