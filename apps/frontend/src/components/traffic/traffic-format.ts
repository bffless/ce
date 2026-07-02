/** Access-log status coloring shared by the Live tail and History views. */
export function statusColorClass(status: number): string {
  if (status >= 500) return 'text-red-600 dark:text-red-400';
  if (status >= 400) return 'text-amber-600 dark:text-amber-400';
  if (status >= 300) return 'text-blue-600 dark:text-blue-400';
  return 'text-emerald-700 dark:text-emerald-400';
}
