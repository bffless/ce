import { redactSecrets } from './redact-secrets';

describe('redactSecrets', () => {
  it('replaces a secret value occurrence in a string', () => {
    const result = redactSecrets('token is sk_live_abcdef', ['sk_live_abcdef']);
    expect(result).toBe('token is ***');
  });

  it('redacts secrets nested in objects and arrays', () => {
    const input = {
      a: 'prefix sk_live_abcdef suffix',
      b: ['x', { c: 'sk_live_abcdef' }],
      n: 42,
    };
    const result = redactSecrets(input, ['sk_live_abcdef']);
    expect(result).toEqual({
      a: 'prefix *** suffix',
      b: ['x', { c: '***' }],
      n: 42,
    });
  });

  it('replaces every occurrence of a secret', () => {
    const result = redactSecrets('sk_live_abcdef and sk_live_abcdef', ['sk_live_abcdef']);
    expect(result).toBe('*** and ***');
  });

  it('does not redact secrets shorter than the minimum length', () => {
    // "abc" is below the redaction floor — must not mangle output.
    const result = redactSecrets('abc def abcdef', ['abc']);
    expect(result).toBe('abc def abcdef');
  });

  it('handles multiple secrets, longest match first', () => {
    const result = redactSecrets('value=SUPER_SECRET_TOKEN', [
      'SECRET_TOKEN',
      'SUPER_SECRET_TOKEN',
    ]);
    expect(result).toBe('value=***');
  });

  it('returns the value unchanged when there are no redactable secrets', () => {
    const input = { a: 'untouched' };
    const result = redactSecrets(input, []);
    expect(result).toBe(input);
  });

  it('leaves non-plain objects (e.g. Date) intact', () => {
    const date = new Date('2020-01-01T00:00:00.000Z');
    const result = redactSecrets({ when: date }, ['sk_live_abcdef']);
    expect(result.when).toBe(date);
  });
});
