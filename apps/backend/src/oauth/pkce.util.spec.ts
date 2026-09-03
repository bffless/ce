import { challengeOf, isValidVerifier, verifyS256 } from './pkce.util';

describe('pkce', () => {
  // RFC 7636 appendix B
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('matches the RFC example and refuses plain', () => {
    expect(challengeOf(verifier)).toBe(challenge);
    expect(verifyS256(verifier, challenge)).toBe(true);
    expect(verifyS256(verifier, verifier)).toBe(false);
    expect(verifyS256('x'.repeat(43), challenge)).toBe(false);
  });

  it('validates verifier shape', () => {
    expect(isValidVerifier(verifier)).toBe(true);
    expect(isValidVerifier('x'.repeat(42))).toBe(false);
    expect(isValidVerifier('x'.repeat(129))).toBe(false);
    expect(isValidVerifier('has space'.padEnd(43, 'x'))).toBe(false);
    expect(isValidVerifier(42)).toBe(false);
  });
});
