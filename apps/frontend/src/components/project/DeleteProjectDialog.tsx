import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteProjectMutation } from '@/services/projectsApi';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

interface DeleteProjectDialogProps {
  projectId: string;
  owner: string;
  repo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * DeleteProjectDialog - Confirmation dialog for deleting a project
 * Requires the user to type "owner/repo" to confirm deletion
 */
export function DeleteProjectDialog({
  projectId,
  owner,
  repo,
  open,
  onOpenChange,
}: DeleteProjectDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deleteProject, { isLoading }] = useDeleteProjectMutation();
  const [confirmText, setConfirmText] = useState('');

  const expectedText = `${owner}/${repo}`;
  const isConfirmed = confirmText === expectedText;

  const handleDelete = async () => {
    if (!isConfirmed) return;

    try {
      await deleteProject(projectId).unwrap();

      toast({
        title: 'Repository deleted',
        description: `${expectedText} has been permanently deleted.`,
      });

      onOpenChange(false);
      navigate('/repo');
    } catch (error: any) {
      const errorMessage =
        error?.data?.message || error?.message || 'Failed to delete repository';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setConfirmText('');
    }
    onOpenChange(newOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Repository</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>
                This will permanently delete the repository <strong>{expectedText}</strong> and
                all of its data, including:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>All deployments and aliases</li>
                <li>All uploaded files and assets</li>
                <li>All permissions and settings</li>
              </ul>
              <p className="mt-3">
                This action <strong>cannot be undone</strong>.
              </p>
              <div className="mt-4 space-y-2">
                <Label htmlFor="confirm-delete">
                  Type <strong>{expectedText}</strong> to confirm:
                </Label>
                <Input
                  id="confirm-delete"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={expectedText}
                  autoComplete="off"
                  disabled={isLoading}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={!isConfirmed || isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Repository
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
