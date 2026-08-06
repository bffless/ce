import type { NormalizedSyncRule } from './sync-plan.util';

/**
 * Field-level three-way merge for a rule.
 *
 * Rule-level comparison manufactures conflicts that aren't real: an app
 * improving a step's `systemPrompt` and a user repointing that same step's
 * `skills` are edits to different fields, and both can land. Merging per field
 * — recursing into `pipelineConfig`, and into pipeline steps by their `id` —
 * means only a genuine same-field disagreement ever needs resolving.
 *
 * `base` is what the last sync wrote, `ours` the live (possibly user-edited)
 * rule, `theirs` the incoming payload.
 */

export type ConflictPolicy = 'overwrite' | 'preserve';

export interface MergeResult {
  merged: NormalizedSyncRule;
  /** Dotted paths of fields both sides changed differently, e.g.
   *  `pipelineConfig.steps.draft.config.skills`. Empty when fully auto-merged. */
  conflicts: string[];
}

/** Keys whose value is `undefined` are treated as absent (mirrors sync-plan). */
function definedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).filter((k) => o[k] !== undefined);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = definedKeys(ao);
    if (aKeys.length !== definedKeys(bo).length) return false;
    return aKeys.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A pipeline `steps`/`postSteps` array: every entry an object with a string id. */
function isStepArray(v: unknown): v is Array<Record<string, unknown>> {
  return (
    Array.isArray(v) && v.length > 0 && v.every((s) => isPlainObject(s) && typeof s.id === 'string')
  );
}

function stepIds(steps: Array<Record<string, unknown>>): string[] {
  return steps.map((s) => s.id as string);
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  policy: ConflictPolicy,
  path: string,
  conflicts: string[],
): unknown {
  // Nobody disagrees, or only one side moved — all decidable without recursing.
  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(ours, base)) return theirs;
  if (deepEqual(theirs, base)) return ours;

  // Both moved. Recurse where the shape lets us attribute the change to a
  // narrower field; otherwise this really is a conflict.
  if (isStepArray(base) && isStepArray(ours) && isStepArray(theirs)) {
    const ids = stepIds(theirs);
    // A step added or removed is structural: merging by id would silently
    // reorder a pipeline into a shape neither side asked for.
    const sameShape =
      deepEqual([...ids].sort(), [...stepIds(ours)].sort()) &&
      deepEqual([...ids].sort(), [...stepIds(base)].sort());
    if (sameShape) {
      const byId = (steps: Array<Record<string, unknown>>, id: string) =>
        steps.find((s) => s.id === id);
      return ids.map((id) =>
        mergeValue(byId(base, id), byId(ours, id), byId(theirs, id), policy, `${path}.${id}`, conflicts),
      );
    }
    conflicts.push(path);
    return policy === 'preserve' ? ours : theirs;
  }

  if (isPlainObject(base) && isPlainObject(ours) && isPlainObject(theirs)) {
    const keys = new Set([...definedKeys(base), ...definedKeys(ours), ...definedKeys(theirs)]);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const value = mergeValue(
        base[key],
        ours[key],
        theirs[key],
        policy,
        path ? `${path}.${key}` : key,
        conflicts,
      );
      // Both sides dropping the key must leave it dropped, not set to undefined.
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  conflicts.push(path);
  return policy === 'preserve' ? ours : theirs;
}

/**
 * Merge one rule. Returns the merged rule plus the dotted paths of any fields
 * that genuinely conflicted (both sides changed them differently); `policy`
 * decides which side wins those.
 */
export function mergeRuleThreeWay(
  base: NormalizedSyncRule,
  ours: NormalizedSyncRule,
  theirs: NormalizedSyncRule,
  policy: ConflictPolicy,
): MergeResult {
  const conflicts: string[] = [];
  const merged = mergeValue(base, ours, theirs, policy, '', conflicts) as NormalizedSyncRule;
  return { merged, conflicts };
}
