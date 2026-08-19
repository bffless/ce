import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useGenerateUploadSchemaMutation } from '@/services/pipelineSchemasApi';
import { useGetProjectRuleSetsQuery } from '@/services/proxyRulesApi';

type AccessControl = 'public' | 'authenticated' | 'role';

interface GenerateUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

export function GenerateUploadModal({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: GenerateUploadModalProps) {
  const { toast } = useToast();
  const [schemaName, setSchemaName] = useState('');
  const [subDir, setSubDir] = useState('');
  const [dateBucket, setDateBucket] = useState(false);
  const [accessControl, setAccessControl] = useState<AccessControl>('public');
  const [requiredRole, setRequiredRole] = useState('');
  const [allowedMimeTypes, setAllowedMimeTypes] = useState('');
  const [maxFileSize, setMaxFileSize] = useState('');
  const [ruleSetId, setRuleSetId] = useState<string>('');

  const [generateUploadSchema, { isLoading }] = useGenerateUploadSchemaMutation();
  const { data: ruleSetsData } = useGetProjectRuleSetsQuery(projectId, {
    skip: !open,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!schemaName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a schema name',
        variant: 'destructive',
      });
      return;
    }

    const nameRegex = /^[a-z][a-z0-9_]*$/;
    if (!nameRegex.test(schemaName)) {
      toast({
        title: 'Invalid Schema Name',
        description:
          'Schema name must start with a letter and contain only lowercase letters, numbers, and underscores',
        variant: 'destructive',
      });
      return;
    }

    if (!subDir.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a sub-directory name',
        variant: 'destructive',
      });
      return;
    }

    const subDirRegex = /^[a-z][a-z0-9_-]*$/;
    if (!subDirRegex.test(subDir)) {
      toast({
        title: 'Invalid Sub-directory',
        description:
          'Sub-directory must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
        variant: 'destructive',
      });
      return;
    }

    if (accessControl === 'role' && !requiredRole.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a required role',
        variant: 'destructive',
      });
      return;
    }

    try {
      const dto: Record<string, unknown> = {
        projectId,
        name: schemaName,
        subDir,
        dateBucket,
        accessControl,
      };

      if (accessControl === 'role') {
        dto.requiredRole = requiredRole;
      }

      if (allowedMimeTypes.trim()) {
        dto.allowedMimeTypes = allowedMimeTypes.split(',').map((t) => t.trim());
      }

      if (maxFileSize.trim()) {
        const sizeBytes = parseInt(maxFileSize, 10) * 1024 * 1024; // Convert MB to bytes
        if (!isNaN(sizeBytes) && sizeBytes > 0) {
          dto.maxFileSize = sizeBytes;
        }
      }

      if (ruleSetId && ruleSetId !== 'new') {
        dto.ruleSetId = ruleSetId;
      }

      const result = await generateUploadSchema(dto as any).unwrap();

      toast({
        title: 'Upload Schema Generated',
        description: `Created schema "${result.schema.name}" with ${result.pipelines.length} pipeline(s)`,
      });

      onOpenChange(false);
      resetForm();
      onSuccess?.();
    } catch (err: unknown) {
      const errorMessage =
        (err as { data?: { message?: string } })?.data?.message ||
        'Failed to generate upload schema';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const resetForm = () => {
    setSchemaName('');
    setSubDir('');
    setDateBucket(false);
    setAccessControl('public');
    setRequiredRole('');
    setAllowedMimeTypes('');
    setMaxFileSize('');
    setRuleSetId('');
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Upload Schema</DialogTitle>
          <DialogDescription>
            Create a schema and pipelines for file uploads. This will generate POST (upload) and GET
            (serve) endpoints with configurable access control.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="upload-schema-name">Schema Name</Label>
              <Input
                id="upload-schema-name"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value.toLowerCase())}
                placeholder="e.g., product_images, user_avatars"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Use lowercase letters, numbers, and underscores.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-sub-dir">Sub-directory</Label>
              <Input
                id="upload-sub-dir"
                value={subDir}
                onChange={(e) => setSubDir(e.target.value.toLowerCase())}
                placeholder="e.g., images, documents, avatars"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Storage sub-directory for uploaded files. Endpoint will be{' '}
                <code className="text-xs">/api/uploads/{subDir || '{subDir}'}</code>
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="date-bucket">Date Bucketing</Label>
                <p className="text-xs text-muted-foreground">
                  Organize files in YYYY-MM-DD folders
                </p>
              </div>
              <Switch
                id="date-bucket"
                checked={dateBucket}
                onCheckedChange={setDateBucket}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label>Access Control (for serving files)</Label>
              <RadioGroup
                value={accessControl}
                onValueChange={(value) => setAccessControl(value as AccessControl)}
                disabled={isLoading}
              >
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="public" id="access-public" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="access-public" className="font-medium cursor-pointer">
                      Public
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Anyone can access uploaded files.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="authenticated" id="access-auth" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="access-auth" className="font-medium cursor-pointer">
                      Authenticated
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Only authenticated users can access files.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="role" id="access-role" />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="access-role" className="font-medium cursor-pointer">
                      Role-based
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Only users with a specific role can access files.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {accessControl === 'role' && (
              <div className="space-y-2">
                <Label htmlFor="required-role">Required Role</Label>
                <Input
                  id="required-role"
                  value={requiredRole}
                  onChange={(e) => setRequiredRole(e.target.value)}
                  placeholder="e.g., admin, editor"
                  disabled={isLoading}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="mime-types">Allowed MIME Types (optional)</Label>
              <Input
                id="mime-types"
                value={allowedMimeTypes}
                onChange={(e) => setAllowedMimeTypes(e.target.value)}
                placeholder="e.g., image/*, application/pdf"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Leave empty to allow all file types.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-file-size">Max File Size in MB (optional)</Label>
              <Input
                id="max-file-size"
                type="number"
                value={maxFileSize}
                onChange={(e) => setMaxFileSize(e.target.value)}
                placeholder="10"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-rule-set">Proxy Rule Set</Label>
              <Select value={ruleSetId} onValueChange={setRuleSetId} disabled={isLoading}>
                <SelectTrigger id="upload-rule-set">
                  <SelectValue placeholder="Create new rule set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new rule set</SelectItem>
                  {ruleSetsData?.ruleSets?.map((ruleSet) => (
                    <SelectItem key={ruleSet.id} value={ruleSet.id}>
                      {ruleSet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Add upload/serve pipelines to an existing rule set or create a new one.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
