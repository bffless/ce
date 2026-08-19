/**
 * Serialize a filter row's editable text into the stored config value.
 *
 * For the `in` operator a comma-separated string becomes a trimmed string[]
 * (a literal list). A value with no comma is left as a string so runtime
 * expressions (e.g. `steps.folderFeeds.urls`, which never contain commas) are
 * resolved to an array by the backend evaluator, and a single literal is wrapped
 * into a one-element IN by the backend. Every other operator is unchanged.
 */
export function serializeFilterValue(op: string, text: string): string | string[] {
  if (op === 'in' && text.includes(',')) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return text;
}

/** Render a stored filter value (string or array) as editable text. */
export function displayFilterValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}
