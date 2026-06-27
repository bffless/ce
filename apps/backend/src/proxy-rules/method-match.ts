/**
 * Pure HTTP-method matching for proxy rules.
 *
 * Precedence: a non-empty `methods[]` wins; else fall back to the single
 * `method`; else (neither set) match any method. Case-insensitive.
 */

type MethodShape = { method?: string | null; methods?: string[] | null };

function effectiveMethods(rule: MethodShape): string[] | null {
  if (rule.methods && rule.methods.length > 0) {
    return rule.methods.map((m) => String(m).toUpperCase());
  }
  if (rule.method) {
    return [String(rule.method).toUpperCase()];
  }
  return null; // any
}

export function matchesMethod(rule: MethodShape, requestMethod?: string): boolean {
  const allowed = effectiveMethods(rule);
  if (!allowed) return true; // any
  if (!requestMethod) return true; // nothing to compare against
  return allowed.includes(requestMethod.toUpperCase());
}

/**
 * Stable, case-insensitive signature of a rule's method matching, for
 * duplicate detection. '' == matches any. Order-independent for methods[].
 */
export function methodSignature(rule: MethodShape): string {
  if (rule.methods && rule.methods.length > 0) {
    return rule.methods
      .map((m) => String(m).toUpperCase())
      .sort()
      .join(',');
  }
  return rule.method ? String(rule.method).toUpperCase() : '';
}
