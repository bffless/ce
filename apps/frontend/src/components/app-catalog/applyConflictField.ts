/**
 * Write a value at a sync-conflict field path into a rule, returning a new rule.
 *
 * Paths come from the server's three-way merge, which addresses pipeline steps
 * by their `id` (`pipelineConfig.steps.draft.config.skills.enabled`) rather than
 * by index — so a plain index walk would write into the wrong step as soon as
 * the app reorders its pipeline. Anything that doesn't resolve leaves the rule
 * untouched rather than inventing structure.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isStepArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.every((s) => isPlainObject(s) && typeof s.id === 'string');
}

function setIn(node: unknown, segments: string[], value: unknown): unknown | undefined {
  if (segments.length === 0) return value;

  const [head, ...rest] = segments;

  if (isStepArray(node)) {
    const index = node.findIndex((s) => s.id === head);
    if (index === -1) return undefined;
    const child = setIn(node[index], rest, value);
    if (child === undefined) return undefined;
    const next = [...node];
    next[index] = child as Record<string, unknown>;
    return next;
  }

  if (isPlainObject(node)) {
    if (!(head in node)) return undefined;
    const child = setIn(node[head], rest, value);
    if (child === undefined) return undefined;
    return { ...node, [head]: child };
  }

  return undefined;
}

export function applyConflictField<T>(rule: T, path: string, value: unknown): T {
  const next = setIn(rule, path.split('.'), value);
  return next === undefined ? rule : (next as T);
}
