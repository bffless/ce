import { describe, it, expect } from 'vitest';
import type { RemoteConnectionStatus } from '@/services/settingsApi';
import { toConnectionDraft, toTestDraft, toUpsertDto } from './RemoteConnectionForm';

const connection = (over: Partial<RemoteConnectionStatus> = {}): RemoteConnectionStatus => ({
  id: 'c1',
  name: 'pdf-renderer',
  url: 'https://pdf.run.app',
  auth: 'google_id_token',
  hasCredential: true,
  maxInflight: 8,
  healthPath: '/health',
  source: {
    url: 'db',
    auth: 'db',
    credential: 'db',
    maxInflight: 'db',
    healthPath: 'db',
    envOnly: false,
  },
  envOnly: false,
  usedBy: { ffmpegExecutor: false, rules: 0 },
  ...over,
});

describe('toConnectionDraft', () => {
  it('defaults a new connection to google_id_token / 8 / /health', () => {
    expect(toConnectionDraft()).toEqual({
      name: '',
      url: '',
      auth: 'google_id_token',
      credential: '',
      removeCredential: false,
      maxInflight: 8,
      healthPath: '/health',
    });
  });

  it('keeps a saved "no probe" as an empty health path (not the default)', () => {
    expect(toConnectionDraft(connection({ healthPath: null })).healthPath).toBe('');
  });
});

describe('toUpsertDto', () => {
  it('sends the whole draft when creating', () => {
    const draft = { ...toConnectionDraft(), name: 'pdf-renderer', url: 'https://pdf.run.app ' };
    expect(toUpsertDto(undefined, draft)).toEqual({
      name: 'pdf-renderer',
      url: 'https://pdf.run.app',
      auth: 'google_id_token',
      maxInflight: 8,
      healthPath: '/health',
    });
  });

  it('sends nothing when an edit changed nothing', () => {
    const existing = connection();
    expect(toUpsertDto(existing, toConnectionDraft(existing))).toEqual({});
  });

  it('sends only the changed fields', () => {
    const existing = connection();
    const draft = { ...toConnectionDraft(existing), url: 'https://other.run.app', maxInflight: 16 };
    expect(toUpsertDto(existing, draft)).toEqual({
      url: 'https://other.run.app',
      maxInflight: 16,
    });
  });

  it('never sends an env-pinned field — the API refuses any that is merely PRESENT', () => {
    const existing = connection({
      source: {
        url: 'env',
        auth: 'env',
        credential: 'env',
        maxInflight: 'env',
        healthPath: 'env',
        envOnly: false,
      },
    });
    const draft = {
      ...toConnectionDraft(existing),
      url: 'https://tampered.example.com',
      auth: 'none' as const,
      credential: '{"type":"service_account"}',
      maxInflight: 64,
      healthPath: '/other',
    };
    expect(toUpsertDto(existing, draft)).toEqual({});
  });

  it('maps the credential to null on remove, the string on replace, absent otherwise', () => {
    const existing = connection();
    const base = toConnectionDraft(existing);
    expect(toUpsertDto(existing, { ...base, removeCredential: true })).toEqual({
      credential: null,
    });
    expect(toUpsertDto(existing, { ...base, credential: ' key ' })).toEqual({ credential: 'key' });
    expect(toUpsertDto(existing, base)).toEqual({});
  });

  it('maps an emptied health path to null (no probe)', () => {
    const existing = connection();
    expect(toUpsertDto(existing, { ...toConnectionDraft(existing), healthPath: '  ' })).toEqual({
      healthPath: null,
    });
  });
});

describe('toTestDraft', () => {
  it('tests a saved connection by id, leaving the stored credential to the server', () => {
    const existing = connection();
    expect(toTestDraft(existing, toConnectionDraft(existing))).toEqual({
      id: 'c1',
      url: 'https://pdf.run.app',
      auth: 'google_id_token',
      healthPath: '/health',
    });
  });

  it('carries an unsaved credential so a new key can be tested before saving', () => {
    const existing = connection();
    const draft = { ...toConnectionDraft(existing), credential: '{"type":"service_account"}' };
    expect(toTestDraft(existing, draft).credential).toBe('{"type":"service_account"}');
  });
});
