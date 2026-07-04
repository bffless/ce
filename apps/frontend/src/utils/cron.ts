import cronstrue from 'cronstrue';

/**
 * Common cadences offered as one-click presets in the schedule form. Values are
 * standard 5-field cron expressions evaluated in the schedule's timezone.
 */
export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily at 2am', value: '0 2 * * *' },
  { label: 'Weekly (Sun 2am)', value: '0 2 * * 0' },
];

/**
 * Human-readable description of a cron expression, or null when it can't be
 * parsed. cronstrue throws on invalid input; we translate that to null.
 */
export function describeCron(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  try {
    return cronstrue.toString(trimmed, { throwExceptionOnParseError: true });
  } catch {
    return null;
  }
}

export function isValidCron(expression: string): boolean {
  return describeCron(expression) !== null;
}
