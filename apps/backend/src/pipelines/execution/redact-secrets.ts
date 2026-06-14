/**
 * Minimum length for a secret value to be eligible for redaction.
 *
 * Very short secrets (e.g. "1", "abc") would match incidental substrings all
 * over normal output and mangle it. GitHub applies the same kind of floor.
 * Secrets shorter than this are not scrubbed from output — callers should
 * enforce reasonable secret lengths instead.
 */
const MIN_REDACTABLE_LENGTH = 6;

const REDACTION_PLACEHOLDER = '***';

/**
 * Recursively scrub secret values from any JSON-serializable value, returning a
 * redacted deep copy. Any string containing a secret value has every occurrence
 * replaced with `***`. Used to ensure decrypted project secrets can be used by a
 * pipeline but never surface in debug logs, responses, or step outputs.
 *
 * Only plain objects and arrays are traversed; other object types (Date, Buffer,
 * etc.) are returned as-is, since pipeline debug/response data is JSON data.
 */
export function redactSecrets<T>(value: T, secretValues: string[]): T {
  const redactable = secretValues.filter(
    (s) => typeof s === 'string' && s.length >= MIN_REDACTABLE_LENGTH,
  );
  if (redactable.length === 0) {
    return value;
  }
  // Longest-first so overlapping secrets redact the largest match.
  const ordered = [...redactable].sort((a, b) => b.length - a.length);
  return redactValue(value, ordered) as T;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = redactValue(val, secrets);
    }
    return result;
  }

  return value;
}

function redactString(str: string, secrets: string[]): string {
  let result = str;
  for (const secret of secrets) {
    if (result.includes(secret)) {
      result = result.split(secret).join(REDACTION_PLACEHOLDER);
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
