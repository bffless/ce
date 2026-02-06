// Branch color palette
const BRANCH_COLORS = [
  '#3b82f6', // blue (primary - main/master)
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

/**
 * Get a consistent color for a branch name
 */
export function getBranchColor(branchName: string): string {
  // Main branch always blue
  if (branchName === 'main' || branchName === 'master') {
    return BRANCH_COLORS[0];
  }

  // Hash the branch name for consistent color
  let hash = 0;
  for (let i = 0; i < branchName.length; i++) {
    hash = (hash << 5) - hash + branchName.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Use remaining colors (skip blue for main)
  const colorIndex = (Math.abs(hash) % (BRANCH_COLORS.length - 1)) + 1;
  return BRANCH_COLORS[colorIndex];
}

export { BRANCH_COLORS };
