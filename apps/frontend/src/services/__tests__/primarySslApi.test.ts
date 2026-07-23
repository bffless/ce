import { describe, it, expect } from 'vitest';
import { primarySslApi } from '../primarySslApi';

describe('primarySslApi', () => {
  it('exposes the day-2 SSL endpoints', () => {
    const e = primarySslApi.endpoints;
    expect(e.getPrimarySslStatus).toBeDefined();
    expect(e.applyPrimarySsl).toBeDefined();
    expect(e.rollbackPrimarySsl).toBeDefined();
    expect(e.confirmPrimarySsl).toBeDefined();
  });
});
