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
import { useDeleteAliasMutation } from '@/services/repoApi';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface DeleteAliasDialogProps {
  owner: string;
  repo: string;
  aliasName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * DeleteAliasDialog - Confirmation dialog for deleting an alias
 * Used in AliasesTab component
 */
export function DeleteAliasDialog({
  owner,
  repo,
  aliasName,
  open,
  onOpenChange,
}: DeleteAliasDialogProps) {
  const { toast } = useToast();
  const [deleteAlias, { isLoading }] = useDeleteAliasMutation();

  // Handle delete action
  const handleDelete = async () => {
    try {
      await deleteAlias({
        owner,
        repo,
        aliasName,
      }).unwrap();

      // Success!
      toast({
        title: 'Success',
        description: `Alias "${aliasName}" deleted successfully`,
      });

      // Close dialog
      onOpenChange(false);
    } catch (error: any) {
      // Handle error
      const errorMessage =
        error?.data?.message || error?.message || 'Failed to delete alias';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Alias</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the alias "{aliasName}"?
            <br />
            <br />
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
