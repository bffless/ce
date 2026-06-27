import { matchesMethod, methodSignature } from './method-match';

describe('matchesMethod', () => {
  it('matches when request method is in methods[]', () => {
    expect(matchesMethod({ methods: ['GET', 'HEAD'] }, 'GET')).toBe(true);
    expect(matchesMethod({ methods: ['GET', 'HEAD'] }, 'HEAD')).toBe(true);
  });
  it('rejects when request method is not in methods[]', () => {
    expect(matchesMethod({ methods: ['GET', 'HEAD'] }, 'POST')).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(matchesMethod({ methods: ['get'] }, 'GET')).toBe(true);
    expect(matchesMethod({ method: 'get' }, 'GET')).toBe(true);
  });
  it('falls back to single method when methods[] is empty/absent', () => {
    expect(matchesMethod({ method: 'GET' }, 'GET')).toBe(true);
    expect(matchesMethod({ method: 'GET' }, 'POST')).toBe(false);
    expect(matchesMethod({ method: 'GET', methods: [] }, 'POST')).toBe(false);
  });
  it('methods[] takes precedence over method', () => {
    expect(matchesMethod({ method: 'POST', methods: ['GET'] }, 'GET')).toBe(true);
    expect(matchesMethod({ method: 'POST', methods: ['GET'] }, 'POST')).toBe(false);
  });
  it('matches any method when neither methods[] nor method is set', () => {
    expect(matchesMethod({}, 'GET')).toBe(true);
    expect(matchesMethod({ method: null, methods: null }, 'DELETE')).toBe(true);
  });
  it('matches when requestMethod is undefined (no method to compare)', () => {
    expect(matchesMethod({ methods: ['GET'] }, undefined)).toBe(true);
  });
});

describe('methodSignature', () => {
  it('normalizes methods[] order-independently, upper-cased', () => {
    expect(methodSignature({ methods: ['head', 'get'] })).toBe('GET,HEAD');
    expect(methodSignature({ methods: ['GET', 'HEAD'] })).toBe('GET,HEAD');
  });
  it('uses single method when methods[] empty/absent', () => {
    expect(methodSignature({ method: 'get' })).toBe('GET');
  });
  it('is empty string for any-method', () => {
    expect(methodSignature({})).toBe('');
    expect(methodSignature({ method: null, methods: [] })).toBe('');
  });
});
