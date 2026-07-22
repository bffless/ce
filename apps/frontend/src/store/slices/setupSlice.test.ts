import { describe, it, expect } from 'vitest';
import reducer, {
  setServingMode,
  setBootstrapSslMode,
  setBootstrapPort80,
  setBootstrapRealIp,
  setDnsPreflightPassed,
  setWildcardIssued,
} from './setupSlice';

describe('setupSlice - bootstrap SSL wizard state', () => {
  it('setServingMode presets sslMode and clears downstream choices', () => {
    let state = reducer(undefined, setServingMode('cloudflare'));
    expect(state.wizard.servingMode).toBe('cloudflare');
    expect(state.wizard.bootstrapSslMode).toBe('paste');
    state = reducer(state, setBootstrapRealIp({ header: 'X-Forwarded-For', ranges: ['1.2.3.0/24'] }));
    state = reducer(state, setDnsPreflightPassed(true));
    state = reducer(state, setServingMode('none'));
    expect(state.wizard.bootstrapSslMode).toBeNull(); // direct: user must pick LE vs BYO
    expect(state.wizard.bootstrapRealIp).toBeNull();
    expect(state.wizard.dnsPreflightPassed).toBe(false);
  });

  it('setServingMode presets sslMode to paste for proxy mode too', () => {
    const state = reducer(undefined, setServingMode('proxy'));
    expect(state.wizard.servingMode).toBe('proxy');
    expect(state.wizard.bootstrapSslMode).toBe('paste');
  });

  it('setServingMode clears bootstrapPort80 and wildcardIssued on mode change', () => {
    let state = reducer(undefined, setServingMode('none'));
    state = reducer(state, setBootstrapPort80('redirect'));
    state = reducer(state, setWildcardIssued(true));
    expect(state.wizard.bootstrapPort80).toBe('redirect');
    expect(state.wizard.wildcardIssued).toBe(true);
    state = reducer(state, setServingMode('cloudflare'));
    expect(state.wizard.bootstrapPort80).toBeNull();
    expect(state.wizard.wildcardIssued).toBe(false);
  });

  it('setBootstrapSslMode sets the ssl mode directly', () => {
    const state = reducer(undefined, setBootstrapSslMode('letsencrypt'));
    expect(state.wizard.bootstrapSslMode).toBe('letsencrypt');
  });

  it('setDnsPreflightPassed and setWildcardIssued set their booleans directly', () => {
    let state = reducer(undefined, setDnsPreflightPassed(true));
    expect(state.wizard.dnsPreflightPassed).toBe(true);
    state = reducer(state, setWildcardIssued(true));
    expect(state.wizard.wildcardIssued).toBe(true);
  });
});
