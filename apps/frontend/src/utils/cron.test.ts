import { describe, it, expect } from 'vitest';
import { describeCron, isValidCron, CRON_PRESETS } from './cron';

describe('cron helpers', () => {
  it('describes a valid 5-field expression', () => {
    expect(describeCron('*/15 * * * *')).toMatch(/every 15 minutes/i);
  });

  it('returns null for an invalid expression', () => {
    expect(describeCron('not a cron')).toBeNull();
  });

  it('isValidCron reflects validity', () => {
    expect(isValidCron('0 2 * * *')).toBe(true);
    expect(isValidCron('99 99 99 99 99')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });

  it('exposes presets whose values are valid cron', () => {
    expect(CRON_PRESETS.length).toBeGreaterThan(0);
    for (const preset of CRON_PRESETS) {
      expect(isValidCron(preset.value)).toBe(true);
    }
  });
});
