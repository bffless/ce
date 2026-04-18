import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ExpressionInput } from './ExpressionInput';
import type { PreviousStep } from './AvailableVariables';

interface GitHubApiConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  previousSteps: PreviousStep[];
}

export function GitHubApiConfig({ config, onChange, previousSteps }: GitHubApiConfigProps) {
  const action = (config.action as string) || 'create_repo_from_template';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Action</Label>
        <Select
          value={action}
          onValueChange={(value) => onChange({ ...config, action: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create_repo_from_template">Create Repo from Template</SelectItem>
            <SelectItem value="set_repo_variable">Set Repo Variable</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {action === 'set_repo_variable' && (
        <>
          <div className="space-y-2">
            <Label>Owner *</Label>
            <ExpressionInput
              value={(config.owner as string) || ''}
              onChange={(value) => onChange({ ...config, owner: value })}
              placeholder="bffless-sites"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository owner (org or user)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo *</Label>
            <ExpressionInput
              value={(config.repo as string) || ''}
              onChange={(value) => onChange({ ...config, repo: value })}
              placeholder="steps.create_repo.name"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Repository name
            </p>
          </div>

          <div className="space-y-2">
            <Label>Variable Name *</Label>
            <ExpressionInput
              value={(config.variableName as string) || ''}
              onChange={(value) => onChange({ ...config, variableName: value })}
              placeholder="SITE_DOMAIN"
              previousSteps={previousSteps}
            />
          </div>

          <div className="space-y-2">
            <Label>Variable Value *</Label>
            <ExpressionInput
              value={(config.variableValue as string) || ''}
              onChange={(value) => onChange({ ...config, variableValue: value })}
              placeholder="steps.build_name.siteUrl"
              previousSteps={previousSteps}
            />
          </div>
        </>
      )}

      {action === 'create_repo_from_template' && (
        <>
          <div className="space-y-2">
            <Label>Template Owner *</Label>
            <ExpressionInput
              value={(config.templateOwner as string) || ''}
              onChange={(value) => onChange({ ...config, templateOwner: value })}
              placeholder="bffless-templates"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              GitHub org or user that owns the template repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Template Repo *</Label>
            <ExpressionInput
              value={(config.templateRepo as string) || ''}
              onChange={(value) => onChange({ ...config, templateRepo: value })}
              placeholder="my-template"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Name of the template repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Target Organization *</Label>
            <ExpressionInput
              value={(config.targetOrg as string) || ''}
              onChange={(value) => onChange({ ...config, targetOrg: value })}
              placeholder="my-org"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              GitHub org where the new repo will be created
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repo Name *</Label>
            <ExpressionInput
              value={(config.repoName as string) || ''}
              onChange={(value) => onChange({ ...config, repoName: value })}
              placeholder="steps.validate.repoName"
              previousSteps={previousSteps}
            />
            <p className="text-xs text-muted-foreground">
              Name for the new repository
            </p>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <ExpressionInput
              value={(config.description as string) || ''}
              onChange={(value) => onChange({ ...config, description: value })}
              placeholder="steps.validate.description"
              previousSteps={previousSteps}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={config.private !== false}
              onCheckedChange={(checked) => onChange({ ...config, private: checked })}
            />
            <Label>Private repository</Label>
          </div>
        </>
      )}
    </div>
  );
}
