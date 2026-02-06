export interface CommitNode {
  sha: string;
  shortSha: string;
  branch: string;
  description: string | null;
  deployedAt: string;
}
