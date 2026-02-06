import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useDeleteCommitMutation } from '@/services/repoApi';
import { formatStorageSize } from '@/lib/utils';

export interface DeleteCommitButtonProps {
  owner: string;
  repo: string;
  commitSha: string;
  aliases: string[];
  deploymentCount: number;
  totalSize: number;
  totalFiles: number;
  /** Optional callback to get the next navigation target after deletion.
   *  Return a commit SHA to navigate to, or undefined to go to repo overview.
   */
  onGetNextTarget?: () => string | undefined;
}

export function DeleteCommitButton({
  owner,
  repo,
  commitSha,
  aliases,
  deploymentCount,
  totalSize,
  totalFiles,
  onGetNextTarget,
}: DeleteCommitButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [deleteCommit, { isLoading }] = useDeleteCommitMutation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const hasAliases = aliases.length > 0;
  const shortSha = commitSha.slice(0, 7);

  const handleDelete = async () => {
    try {
      const result = await deleteCommit({ owner, repo, commitSha }).unwrap();

      toast({
        title: 'Commit deleted',
        description: `Freed ${formatStorageSize(result.freedBytes)} from ${result.deletedFiles} files`,
      });

      // Navigate to next commit if available, otherwise to repo overview
      const nextTarget = onGetNextTarget?.();
      if (nextTarget) {
        navigate(`/repo/${owner}/${repo}/${nextTarget}`);
      } else {
        navigate(`/repo/${owner}/${repo}`);
      }
    } catch (error: unknown) {
      const err = error as { data?: { message?: string; aliases?: string[] } };
      const errorMessage = err?.data?.message || 'Failed to delete commit';
      const errorAliases = err?.data?.aliases;

      toast({
        variant: 'destructive',
        title: 'Cannot delete commit',
        description: errorAliases
          ? `${errorMessage}: ${errorAliases.join(', ')}`
          : errorMessage,
      });

      setIsOpen(false);
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button
                variant="destructive"
                size="sm"
                disabled={hasAliases || isLoading}
                onClick={() => setIsOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Commit
              </Button>
            </span>
          </TooltipTrigger>
          {hasAliases && (
            <TooltipContent>
              <p>Cannot delete: commit has active aliases</p>
              <p className="text-muted-foreground">
                ({aliases.join(', ')})
              </p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Delete Commit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this commit? This action cannot be undone.
              All files and deployments associated with this commit will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4 p-4 bg-muted rounded-lg space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">SHA</span>
              <code className="text-sm font-mono bg-background px-2 py-1 rounded">
                {shortSha}
              </code>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Deployments</span>
              <span className="text-sm font-medium">{deploymentCount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Size</span>
              <span className="text-sm font-medium">{formatStorageSize(totalSize)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Files</span>
              <span className="text-sm font-medium">{totalFiles.toLocaleString()}</span>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Commit'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
